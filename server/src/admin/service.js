// What the Ops Console needs that other modules don't already provide: the overview, all jobs, insurance
// expirations, and partner balances. Staff only.
import { HttpError } from "../lib/http.js";
import { serviceById } from "../catalog/services.js";

const DAY = 86_400_000;
const J = (s, d) => (s ? JSON.parse(s) : d);
const LIVE = ["en_route", "arrived", "in_progress"];
const WAITING = ["requested", "awaiting_approval"];
const POLICIES = [["auto", "Vehicle insurance"], ["gl", "General liability"], ["gk", "Garagekeepers"], ["wc", "Workers' comp"]];
const name = (u) => (u ? `${u.first_name} ${u.last_name}` : null);

// Start of today in Knoxville, as a timestamp.
function startOfDayEastern(ms) {
  const d = new Date(ms);
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })
    .formatToParts(d).map((x) => [x.type, Number(x.value)]));
  return ms - (((parts.hour % 24) * 60 + parts.minute) * 60 + parts.second) * 1000 - d.getMilliseconds();
}

export function createAdmin({ db, jobs, photos, payments, notify = null, now = () => Date.now() }) {
  let lastReminders = 0;
  const daysUntil = (date) => (date ? Math.floor((Date.parse(`${date}T12:00:00Z`) - now()) / DAY) : null);

  // Every policy on file with when it expires, for partners who chose their coverage.
  async function policies() {
    const rows = await db.all(
      `SELECT a.user_id, a.answers, u.first_name, u.last_name, u.email, p.status FROM partner_applications a JOIN users u ON u.id = a.user_id JOIN partner_profiles p ON p.user_id = a.user_id`,
    );
    const docs = await db.all(`SELECT user_id, kind, status FROM partner_documents WHERE replaced_at IS NULL AND kind IN ('auto', 'gl', 'gk', 'wc')`);
    const docBy = new Map(docs.map((d) => [`${d.user_id}:${d.kind}`, d.status]));
    const out = [];
    for (const r of rows) {
      const ans = J(r.answers, {});
      const ins = ans.insurance || {};
      if (!ins.coverage) continue;
      const need = { auto: true, gl: ins.coverage !== "aa", gk: ins.coverage === "own", wc: (ans.business || {}).employees === "5+" };
      for (const [k, label] of POLICIES) {
        if (!need[k]) continue;
        const expires = ins[`${k}Expires`] || null;
        out.push({
          partnerId: r.user_id, partner: name(r), email: r.email, partnerStatus: r.status, coverage: ins.coverage, policy: k, label,
          carrier: ins[`${k}Carrier`] || null, policyNumber: ins[`${k}Policy`] || null, expires, daysLeft: daysUntil(expires), document: docBy.get(`${r.user_id}:${k}`) || "missing",
        });
      }
    }
    return out.sort((a, b) => (a.daysLeft ?? -1e9) - (b.daysLeft ?? -1e9));
  }

  async function jobRow(j, users) {
    const c = users.get(j.customer_id);
    const pt = j.partner_id ? users.get(j.partner_id) : null;
    const q = J(j.final, null) || J(j.quote, {});
    return {
      id: j.id, status: j.status, kind: j.kind, windowStart: j.window_start, windowEnd: j.window_end, createdAt: j.created_at,
      services: J(j.service_ids, []).map((s) => (serviceById(s) || {}).name || s), customer: name(c), partner: name(pt),
      totalCents: q.chargeCents ?? q.totalCents ?? null, paymentStatus: j.payment_status,
      late: j.status === "confirmed" && !j.trip_started_at && now() >= j.window_start - 30 * 60_000,
    };
  }

  const api = {
    async overview() {
      const n = async (sql, params = []) => Number((await db.get(sql, params)).n);
      const day0 = startOfDayEastern(now());
      const done = await db.all(`SELECT final FROM jobs WHERE status = 'completed' AND completed_at >= $1`, [day0]);
      const pol = await policies();
      return {
        applications: await n(`SELECT COUNT(*) AS n FROM partner_profiles WHERE status = 'in_review'`),
        partnersFlagged: await n(`SELECT COUNT(*) AS n FROM partner_profiles WHERE review_reason IS NOT NULL AND status = 'active'`),
        incidentsOpen: await n(`SELECT COUNT(*) AS n FROM incidents WHERE status = 'open'`),
        jobsWaiting: await n(`SELECT COUNT(*) AS n FROM jobs WHERE status IN ('requested', 'awaiting_approval')`),
        jobsLive: await n(`SELECT COUNT(*) AS n FROM jobs WHERE status IN ('en_route', 'arrived', 'in_progress')`),
        jobsLate: await n(`SELECT COUNT(*) AS n FROM jobs WHERE status = 'confirmed' AND trip_started_at IS NULL AND window_start - 1800000 <= $1`, [now()]),
        paymentProblems: await n(`SELECT COUNT(*) AS n FROM jobs WHERE payment_status IN ('hold_failed', 'charge_failed')`),
        payoutsFailed: await n(`SELECT COUNT(*) AS n FROM payouts WHERE status = 'failed' AND created_at >= $1`, [now() - 7 * DAY]),
        insuranceExpiring: pol.filter((x) => x.daysLeft != null && x.daysLeft >= 0 && x.daysLeft < 30).length,
        insuranceExpired: pol.filter((x) => x.daysLeft != null && x.daysLeft < 0).length,
        today: { completed: done.length, chargedCents: done.reduce((a, j) => a + (J(j.final, {}).chargeCents || 0), 0) },
        partnersActive: await n(`SELECT COUNT(*) AS n FROM partner_profiles WHERE status = 'active'`),
        customers: await n(`SELECT COUNT(*) AS n FROM users WHERE role = 'customer'`),
        fleetsInReview: await n(`SELECT COUNT(*) AS n FROM fleets WHERE status = 'review'`),
        fleetInvoicesPastDue: await n(`SELECT COUNT(*) AS n FROM fleet_invoices WHERE status = 'open' AND due_at < $1`, [now()]),
        fleetRunsWaiting: await n(`SELECT COUNT(*) AS n FROM fleet_runs WHERE status = 'posted' AND window_start - 86400000 <= $1`, [now()]),
        // Proof or certificates uploaded by approved partners (for example to add brake or glass work).
        docsToReview: await n(`SELECT COUNT(*) AS n FROM partner_documents d JOIN partner_profiles p ON p.user_id = d.user_id WHERE d.status = 'pending' AND d.replaced_at IS NULL AND p.status IN ('active', 'paused')`),
        claimsOpen: await n(`SELECT COUNT(*) AS n FROM claims WHERE status <> 'closed'`),
        claimsReady: await n(`SELECT COUNT(*) AS n FROM claims WHERE status = 'review'`),
        warrantyOpen: await n(`SELECT COUNT(*) AS n FROM jobs WHERE comeback_of IS NOT NULL AND status IN ('requested','awaiting_approval','confirmed','en_route','arrived','in_progress')`),
        lowRatings: await n(`SELECT COUNT(*) AS n FROM ratings WHERE stars <= 2 AND followed_up_at IS NULL`),
        notifyFailures: await n(`SELECT COUNT(*) AS n FROM notification_outbox WHERE status = 'failed' AND created_at >= $1`, [now() - 7 * DAY]),
        notifyProviders: notify ? notify.providers() : null,
      };
    },

    // Reminders that go out on a schedule: insurance expiring in 30, 14, and 3 days, and the day it expires.
    // Each one is sent once (the notification's dedupe key). Checked every 10 minutes.
    async reminders() {
      if (!notify || now() - lastReminders < 10 * 60_000) return 0;
      lastReminders = now();
      let sent = 0;
      for (const p of await policies()) {
        if (p.daysLeft == null || !["active", "paused"].includes(p.partnerStatus)) continue;
        const mark = p.daysLeft < 0 ? "expired" : [3, 14, 30].find((d) => p.daysLeft <= d);
        if (mark == null) continue;
        const id = await notify.send(db, p.partnerId, {
          category: "account", dedupe: `insurance:${p.policy}:${p.expires}:${mark}`,
          title: mark === "expired" ? `${p.label} expired` : `${p.label} expires in ${p.daysLeft} day${p.daysLeft === 1 ? "" : "s"}`,
          body: mark === "expired" ? "Jobs that need this policy are paused until you upload the renewed certificate." : `Upload the renewed certificate before ${p.expires} so your jobs don't pause.`,
          data: { route: "/onboarding/insurance" },
        });
        if (id) sent++;
      }
      return sent;
    },

    async jobs({ filter = "open", q = "" } = {}) {
      const where = {
        open: `status IN ('requested','awaiting_approval','confirmed','en_route','arrived','in_progress')`,
        live: `status IN ('en_route','arrived','in_progress')`,
        waiting: `status IN ('requested','awaiting_approval')`,
        late: `status = 'confirmed' AND trip_started_at IS NULL AND window_start - 1800000 <= ${Number(now())}`,
        payment: `payment_status IN ('hold_failed','charge_failed')`,
        completed: `status = 'completed'`,
        cancelled: `status IN ('cancelled','expired')`,
        all: "1 = 1",
      }[filter];
      if (!where) throw new HttpError(422, "invalid_input", "Some fields need fixing.", { fields: { filter: "Unknown filter." } });
      const rows = await db.all(`SELECT * FROM jobs WHERE ${where} ORDER BY CASE WHEN status IN ('completed','cancelled','expired') THEN updated_at ELSE -window_start END DESC LIMIT 300`);
      const ids = [...new Set(rows.flatMap((j) => [j.customer_id, j.partner_id]).filter(Boolean))];
      const users = new Map();
      for (const id of ids) users.set(id, await db.get(`SELECT id, first_name, last_name, email FROM users WHERE id = $1`, [id]));
      let out = await Promise.all(rows.map((j) => jobRow(j, users)));
      const needle = String(q || "").trim().toLowerCase();
      if (needle) out = out.filter((j) => [j.id, j.customer, j.partner, ...j.services].filter(Boolean).some((x) => String(x).toLowerCase().includes(needle)));
      return out;
    },

    // Everything about one job: what the customer sees, plus both people's contact details, all photos, money, and incidents.
    async job(id) {
      const raw = await db.get(`SELECT * FROM jobs WHERE id = $1`, [String(id)]);
      if (!raw) throw new HttpError(404, "not_found", "No job with that ID.");
      const view = await db.tx(async (t) => jobs.customerView(t, raw));
      const person = async (uid) => (uid ? db.get(`SELECT id, first_name, last_name, email, phone FROM users WHERE id = $1`, [uid]) : null);
      const [c, pt] = await Promise.all([person(raw.customer_id), person(raw.partner_id)]);
      const fullPlace = await db.get(`SELECT street, unit, city, state, zip, notes FROM places WHERE id = $1`, [raw.place_id]);
      const incidents = await db.all(`SELECT id FROM incidents WHERE job_id = $1 ORDER BY created_at`, [raw.id]);
      return {
        ...view,
        place: { ...view.place, ...fullPlace },
        customer: c && { id: c.id, name: name(c), email: c.email, phone: c.phone },
        partnerContact: pt && { id: pt.id, name: name(pt), email: pt.email, phone: pt.phone },
        allPhotos: photos ? await photos.forJob(db, raw.id) : null,
        partnerPay: J(raw.final, {}).partnerPay || null,
        incidents: photos ? await Promise.all(incidents.map((i) => photos.incident(i.id))) : [],
      };
    },

    insurance: policies,

    async payouts() {
      const accts = await db.all(`SELECT a.*, u.first_name, u.last_name, u.email FROM payout_accounts a JOIN users u ON u.id = a.user_id`);
      const partners = [];
      for (const a of accts) {
        const info = await payments.payoutInfo({ id: a.user_id });
        partners.push({ partnerId: a.user_id, partner: name(a), email: a.email, payoutsEnabled: !!a.payouts_enabled, ...info.balance, schedule: info.schedule.kind, jobsDone: info.schedule.jobsDone, lastPayout: info.payouts[0] || null });
      }
      const recent = await db.all(`SELECT p.*, u.first_name, u.last_name FROM payouts p JOIN users u ON u.id = p.partner_id ORDER BY CASE p.status WHEN 'failed' THEN 0 ELSE 1 END, p.created_at DESC LIMIT 100`);
      return {
        enabled: payments.enabled,
        partners: partners.sort((a, b) => b.availableCents - a.availableCents),
        payouts: recent.map((p) => ({ id: p.id, partner: name(p), kind: p.kind, amountCents: p.amount_cents, feeCents: p.fee_cents, status: p.status, error: p.error, at: p.created_at })),
      };
    },
  };
  return api;
}
