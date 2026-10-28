// Notifications (step 13). Every update lands in the app's inbox; it can also go out as a phone alert, a text,
// or an email, depending on each person's settings. Delivery happens after the change that caused it is saved
// (rows wait in notification_outbox), so a slow provider never holds up a request and nothing is sent for a
// change that was rolled back.
import { HttpError } from "../lib/http.js";
import { newId } from "../auth/tokens.js";
import { createEmail, createPush, createSms, toE164 } from "./providers.js";

const MIN = 60_000;
const RETRY_MIN = [1, 5, 30];
const J = (s, d = null) => (s ? JSON.parse(s) : d);

// [id, label, [push, text, email] defaults]
export const CATEGORIES = {
  customer: [
    ["booking", "Booking updates", [1, 1, 0]],
    ["on_the_way", "Partner on the way", [1, 1, 0]],
    ["addons", "Add-on requests", [1, 1, 0]],
    ["messages", "Messages", [1, 0, 0]],
    ["receipts", "Receipts & charges", [1, 0, 1]],
    ["claims", "Claims & warranty", [1, 0, 1]],
  ],
  partner: [
    ["offers", "New job offers", [1, 1, 0]],
    ["jobs", "Job updates", [1, 1, 0]],
    ["messages", "Messages", [1, 0, 0]],
    ["earnings", "Earnings & payouts", [1, 0, 1]],
    ["reviews", "Ratings & tips", [1, 0, 0]],
    ["claims", "Claims & warranty", [1, 0, 1]],
    ["account", "Account & documents", [1, 0, 1]],
  ],
};
const bad = (field, msg) => new HttpError(422, "invalid_input", "Some fields need fixing.", { fields: { [field]: msg } });

export function createNotify({ db, config = {}, fetchImpl = globalThis.fetch, now = () => Date.now(), log = () => {}, autoFlush = true }) {
  const push = createPush({ baseUrl: (config.push || {}).baseUrl, accessToken: (config.push || {}).accessToken, fetchImpl });
  const pushOn = (config.push || {}).on !== false;
  const sms = createSms({ ...(config.twilio || {}), fetchImpl });
  const email = createEmail({ ...(config.email || {}), fetchImpl });
  const appName = "Auto-Auto";

  const cats = (role) => CATEGORIES[role] || [];

  async function prefsFor(q, user) {
    const rows = await q.all(`SELECT * FROM notification_prefs WHERE user_id = $1`, [user.id]);
    const by = Object.fromEntries(rows.map((r) => [r.category, r]));
    return cats(user.role).map(([id, label, d]) => {
      const r = by[id];
      return { id, label, push: r ? !!r.push : !!d[0], sms: r ? !!r.sms : !!d[1], email: r ? !!r.email : !!d[2] };
    });
  }

  // Adds an inbox notification and queues its delivery. q is the database or the current transaction.
  // dedupe: a key that makes the same reminder go out only once per person.
  async function send(q, userId, { category, title, body, data = null, dedupe = null, emailText = null }) {
    if (!userId) return null;
    const user = await q.get(`SELECT id, role, email, phone, sms_opt_in_at, disabled_at FROM users WHERE id = $1`, [userId]);
    if (!user || user.disabled_at) return null;
    const id = newId();
    const at = now();
    const r = await q.run(
      `INSERT INTO notifications (id, user_id, category, title, body, data, dedupe_key, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (user_id, dedupe_key) DO NOTHING`,
      [id, user.id, category, String(title).slice(0, 120), String(body).slice(0, 500), data ? JSON.stringify({ ...data, ...(emailText ? { emailText } : {}) }) : emailText ? JSON.stringify({ emailText }) : null, dedupe, at],
    );
    if (!r.changes) return null;
    const pref = (await prefsFor(q, user)).find((p) => p.id === category);
    if (!pref) return id;
    const channels = [];
    if (pref.push && pushOn) channels.push("push");
    if (pref.sms && user.sms_opt_in_at && toE164(user.phone)) channels.push("sms");
    if (pref.email && user.email) channels.push("email");
    for (const ch of channels) {
      await q.run(`INSERT INTO notification_outbox (id, notification_id, user_id, channel, status, next_at, created_at) VALUES ($1, $2, $3, $4, 'pending', $5, $5)`, [newId(), id, user.id, ch, at]);
    }
    if (channels.length && autoFlush) setTimeout(() => api.flush().catch((e) => log(`[notify] ${e.message}`)), 150).unref?.();
    return id;
  }

  async function deliver(row) {
    const n = await db.get(`SELECT * FROM notifications WHERE id = $1`, [row.notification_id]);
    const user = await db.get(`SELECT id, role, email, phone, sms_opt_in_at, first_name FROM users WHERE id = $1`, [row.user_id]);
    if (!n || !user) return { status: "skipped", error: "gone" };
    const data = J(n.data, {}) || {};
    if (row.channel === "push") {
      const tokens = await db.all(`SELECT token FROM push_tokens WHERE user_id = $1`, [user.id]);
      if (!tokens.length) return { status: "skipped", error: "no phone registered" };
      const { emailText: _e, ...pushData } = data;
      const res = await push.send(tokens.map((t) => ({ to: t.token, title: n.title, body: n.body, data: { ...pushData, notificationId: n.id } })));
      for (const [i, r] of res.entries()) if (r === "gone") await db.run(`DELETE FROM push_tokens WHERE token = $1`, [tokens[i].token]);
      return res.includes("ok") ? { status: "sent" } : { status: "failed", error: res.join(", "), permanent: true };
    }
    if (row.channel === "sms") {
      const to = toE164(user.phone);
      if (!to || !user.sms_opt_in_at) return { status: "skipped", error: "no consent or number" };
      if (!sms.connected) { log(`[sms] texts aren't connected; would text ${user.role} ${user.id}: "${n.title}"`); return { status: "skipped", error: "not connected" }; }
      const first = !(await db.get(`SELECT id FROM notification_outbox WHERE user_id = $1 AND channel = 'sms' AND status = 'sent' LIMIT 1`, [user.id]));
      try {
        await sms.send({ to, body: `${appName}: ${n.title}. ${n.body}${first ? " Reply STOP to stop texts." : ""}`.slice(0, 600) });
      } catch (e) {
        // They replied STOP: turn texts off so we stop trying.
        if (e.code === "21610") await db.run(`UPDATE users SET sms_opt_in_at = NULL WHERE id = $1`, [user.id]);
        throw e;
      }
      return { status: "sent" };
    }
    if (row.channel === "email") {
      if (!email.connected) { log(`[mail] email isn't connected; would email ${user.role} ${user.id}: "${n.title}"`); return { status: "skipped", error: "not connected" }; }
      const text = `Hi ${user.first_name},\n\n${data.emailText || n.body}\n\nOpen the ${appName} app for the details.\n\nTo change what we send you: open the app, then Notifications › Settings.\n`;
      await email.send({ to: user.email, subject: `${n.title}`, text });
      return { status: "sent" };
    }
    return { status: "skipped", error: "unknown channel" };
  }

  let running = Promise.resolve();
  async function flushOnce() {
    const due = await db.all(`SELECT * FROM notification_outbox WHERE status = 'pending' AND next_at <= $1 ORDER BY next_at LIMIT 100`, [now()]);
    let sent = 0;
    for (const row of due) {
      let out;
      try { out = await deliver(row); } catch (e) { out = { status: "failed", error: e.message, permanent: !!e.permanent }; }
      if (out.status === "failed" && !out.permanent && row.attempts < RETRY_MIN.length) {
        await db.run(`UPDATE notification_outbox SET attempts = attempts + 1, next_at = $1, error = $2 WHERE id = $3`, [now() + RETRY_MIN[row.attempts] * MIN, String(out.error).slice(0, 300), row.id]);
        continue;
      }
      if (out.status === "failed") log(`[notify] ${row.channel} to ${row.user_id} failed: ${out.error}`);
      if (out.status === "sent") sent++;
      await db.run(`UPDATE notification_outbox SET status = $1, attempts = attempts + 1, error = $2, sent_at = $3 WHERE id = $4`,
        [out.status, out.error ? String(out.error).slice(0, 300) : null, out.status === "sent" ? now() : null, row.id]);
    }
    return { processed: due.length, sent };
  }

  const out = (n) => {
    const { emailText: _e, ...data } = J(n.data, {}) || {};
    return { id: n.id, category: n.category, title: n.title, body: n.body, data, read: !!n.read_at, at: n.created_at };
  };

  const api = {
    send,
    CATEGORIES,
    providers: () => ({ push: pushOn, sms: sms.provider, email: email.provider }),
    // Sends what's waiting. Runs every few seconds and right after something is queued.
    flush() { running = running.then(flushOnce, flushOnce); return running; },

    async inbox(user) {
      const rows = await db.all(`SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 60`, [user.id]);
      const unread = Number((await db.get(`SELECT COUNT(*) AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL`, [user.id])).n);
      return { notifications: rows.map(out), unread };
    },
    async markRead(user, b) {
      const ids = Array.isArray(b.ids) ? b.ids.map(String).slice(0, 100) : null;
      if (ids && ids.length) {
        for (const id of ids) await db.run(`UPDATE notifications SET read_at = $1 WHERE id = $2 AND user_id = $3 AND read_at IS NULL`, [now(), id, user.id]);
      } else {
        await db.run(`UPDATE notifications SET read_at = $1 WHERE user_id = $2 AND read_at IS NULL`, [now(), user.id]);
      }
      return api.inbox(user);
    },

    async settings(user) {
      const u = await db.get(`SELECT phone, email, sms_opt_in_at FROM users WHERE id = $1`, [user.id]);
      const devices = Number((await db.get(`SELECT COUNT(*) AS n FROM push_tokens WHERE user_id = $1`, [user.id])).n);
      return {
        categories: await prefsFor(db, user),
        sms: { optedIn: !!u.sms_opt_in_at, phone: u.phone, canText: !!toE164(u.phone), connected: sms.connected },
        email: { address: u.email, connected: email.connected },
        push: { devices, on: pushOn },
      };
    },
    async saveSettings(user, b) {
      const list = await prefsFor(db, user);
      const given = b.categories && typeof b.categories === "object" ? b.categories : {};
      for (const c of list) {
        const g = given[c.id];
        if (!g || typeof g !== "object") continue;
        const next = { push: g.push ?? c.push, sms: g.sms ?? c.sms, email: g.email ?? c.email };
        if (![next.push, next.sms, next.email].every((x) => typeof x === "boolean")) throw bad("categories", "Each switch is on or off.");
        await db.run(
          `INSERT INTO notification_prefs (user_id, category, push, sms, email, updated_at) VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (user_id, category) DO UPDATE SET push = excluded.push, sms = excluded.sms, email = excluded.email, updated_at = excluded.updated_at`,
          [user.id, c.id, next.push ? 1 : 0, next.sms ? 1 : 0, next.email ? 1 : 0, now()],
        );
      }
      if (b.smsOptIn != null) {
        if (typeof b.smsOptIn !== "boolean") throw bad("smsOptIn", "Choose yes or no.");
        const u = await db.get(`SELECT phone, sms_opt_in_at FROM users WHERE id = $1`, [user.id]);
        if (b.smsOptIn && !toE164(u.phone)) throw bad("smsOptIn", "Add your mobile number first (Account › Edit), then turn on texts.");
        if (b.smsOptIn !== !!u.sms_opt_in_at) await db.run(`UPDATE users SET sms_opt_in_at = $1 WHERE id = $2`, [b.smsOptIn ? now() : null, user.id]);
      }
      return api.settings(user);
    },

    async addPushToken(user, b) {
      const token = typeof b.token === "string" ? b.token.trim() : "";
      if (!/^Expo(nent)?PushToken\[[\w-]{10,200}\]$/.test(token)) throw bad("token", "That isn't a phone alert address from this app.");
      const platform = ["ios", "android", "web"].includes(b.platform) ? b.platform : null;
      await db.run(
        `INSERT INTO push_tokens (token, user_id, platform, created_at, last_seen_at) VALUES ($1, $2, $3, $4, $4)
         ON CONFLICT (token) DO UPDATE SET user_id = excluded.user_id, platform = excluded.platform, last_seen_at = excluded.last_seen_at`,
        [token, user.id, platform, now()],
      );
      return { ok: true };
    },
    async removePushToken(user, b) {
      const token = typeof b.token === "string" ? b.token.trim() : "";
      await db.run(`DELETE FROM push_tokens WHERE token = $1 AND user_id = $2`, [token, user.id]);
      return { ok: true };
    },

    // For the Ops Console: which providers are connected and what failed lately.
    async status() {
      const since = now() - 7 * 24 * 60 * MIN;
      const rows = await db.all(`SELECT channel, status, COUNT(*) AS n FROM notification_outbox WHERE created_at >= $1 GROUP BY channel, status`, [since]);
      const counts = {};
      for (const r of rows) (counts[r.channel] = counts[r.channel] || {})[r.status] = Number(r.n);
      const failures = await db.all(`SELECT o.channel, o.error, o.created_at, n.title FROM notification_outbox o LEFT JOIN notifications n ON n.id = o.notification_id WHERE o.status = 'failed' ORDER BY o.created_at DESC LIMIT 20`);
      return {
        providers: { push: pushOn ? "Expo" : null, sms: sms.provider, email: email.provider },
        last7Days: counts,
        failures: failures.map((f) => ({ channel: f.channel, error: f.error, title: f.title, at: f.created_at })),
      };
    },
  };
  return api;
}
