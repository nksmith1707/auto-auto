// Account rules: sign up, sign in, sign out, sessions, password reset.
import { hashPassword, verifyPassword, dummyVerify, passwordProblem } from "./passwords.js";
import { newToken, hashToken, newId } from "./tokens.js";
import { HttpError } from "../lib/http.js";

const DAY = 24 * 60 * 60 * 1000;

export function createAuth({ db, config, mailer, now = () => Date.now() }) {
  const sessionMs = config.sessionDays * DAY;

  const event = (t, userId, kind, ip) =>
    t.run(`INSERT INTO auth_events (id, user_id, kind, ip, created_at) VALUES ($1, $2, $3, $4, $5)`, [newId(), userId, kind, ip || null, now()]);

  async function publicUser(u, t = db) {
    const out = {
      id: u.id, role: u.role, email: u.email, firstName: u.first_name, lastName: u.last_name,
      phone: u.phone, emailVerified: !!u.email_verified_at, createdAt: u.created_at,
    };
    if (u.role === "partner") {
      const p = await t.get(`SELECT status FROM partner_profiles WHERE user_id = $1`, [u.id]);
      const area = await t.get(`SELECT radius_miles FROM partner_service_areas WHERE user_id = $1`, [u.id]);
      const svc = await t.get(`SELECT COUNT(*) AS n FROM partner_services WHERE user_id = $1`, [u.id]);
      const pay = await t.get(`SELECT payouts_enabled FROM payout_accounts WHERE user_id = $1`, [u.id]);
      out.partner = { status: p ? p.status : "applicant", serviceAreaSet: !!area, servicesCount: Number(svc ? svc.n : 0), payoutsEnabled: !!(pay && pay.payouts_enabled) };
    }
    return out;
  }

  async function startSession(t, userId, device) {
    const token = newToken("aa");
    const at = now();
    await t.run(
      `INSERT INTO sessions (id, user_id, token_hash, device, created_at, last_used_at, expires_at) VALUES ($1, $2, $3, $4, $5, $5, $6)`,
      [newId(), userId, hashToken(token), device ? String(device).slice(0, 120) : null, at, at + sessionMs],
    );
    return { token, expiresAt: at + sessionMs };
  }

  return {
    async signup({ role, email, password, firstName, lastName, phone }, { ip, device } = {}) {
      const problem = passwordProblem(password, { email });
      if (problem) throw new HttpError(422, "invalid_input", "Some fields need fixing.", { fields: { password: problem } });
      const hash = await hashPassword(password);
      try {
        return await db.tx(async (t) => {
          const at = now();
          const id = newId();
          await t.run(
            `INSERT INTO users (id, role, email, password_hash, first_name, last_name, phone, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)`,
            [id, role, email, hash, firstName, lastName, phone, at],
          );
          if (role === "partner") {
            await t.run(`INSERT INTO partner_profiles (user_id, status, created_at, updated_at) VALUES ($1, 'applicant', $2, $2)`, [id, at]);
          }
          await event(t, id, "signup", ip);
          const user = await t.get(`SELECT * FROM users WHERE id = $1`, [id]);
          const session = await startSession(t, id, device);
          return { user: await publicUser(user, t), ...session };
        });
      } catch (e) {
        if (/unique|duplicate/i.test(String(e.message)) && /email/i.test(String(e.message) + String(e.constraint || ""))) {
          throw new HttpError(409, "email_taken", "There's already an account with that email. Sign in or reset your password.");
        }
        throw e;
      }
    },

    async login({ email, password }, { ip, device } = {}) {
      const u = await db.get(`SELECT * FROM users WHERE email = $1`, [email]);
      const ok = u ? await verifyPassword(password, u.password_hash) : await dummyVerify(password);
      if (!u || !ok) {
        await event(db, u ? u.id : null, "login_failed", ip);
        throw new HttpError(401, "bad_credentials", "That email and password don't match. Try again or reset your password.");
      }
      if (u.disabled_at) throw new HttpError(403, "account_disabled", "This account is turned off. Contact support for help.");
      return db.tx(async (t) => {
        await event(t, u.id, "login", ip);
        const session = await startSession(t, u.id, device);
        return { user: await publicUser(u, t), ...session };
      });
    },

    // Looks up the user for a bearer token. Returns null if missing, expired, or revoked.
    async authenticate(token) {
      if (!token || token.length > 200) return null;
      const s = await db.get(
        `SELECT s.id AS session_id, s.expires_at, s.revoked_at, s.last_used_at, u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1`,
        [hashToken(token)],
      );
      const t = now();
      if (!s || s.revoked_at || s.expires_at <= t || s.disabled_at) return null;
      if (t - s.last_used_at > 60_000) await db.run(`UPDATE sessions SET last_used_at = $1 WHERE id = $2`, [t, s.session_id]);
      return { sessionId: s.session_id, user: s };
    },

    publicUser,

    async logout(sessionId) {
      await db.run(`UPDATE sessions SET revoked_at = $1 WHERE id = $2 AND revoked_at IS NULL`, [now(), sessionId]);
    },

    async logoutEverywhere(userId) {
      await db.run(`UPDATE sessions SET revoked_at = $1 WHERE user_id = $2 AND revoked_at IS NULL`, [now(), userId]);
    },

    // Always behaves the same whether or not the email exists, so it can't be used to find accounts.
    async requestReset(email, { ip } = {}) {
      const u = await db.get(`SELECT id, email, first_name, disabled_at FROM users WHERE email = $1`, [email]);
      if (!u || u.disabled_at) return;
      const token = newToken("rs");
      const at = now();
      await db.run(`UPDATE password_resets SET used_at = $1 WHERE user_id = $2 AND used_at IS NULL`, [at, u.id]);
      await db.run(
        `INSERT INTO password_resets (id, user_id, token_hash, created_at, expires_at) VALUES ($1, $2, $3, $4, $5)`,
        [newId(), u.id, hashToken(token), at, at + config.resetMinutes * 60_000],
      );
      await event(db, u.id, "reset_requested", ip);
      await mailer.send({
        to: u.email,
        subject: "Reset your Auto-Auto password",
        text: `Hi ${u.first_name},\n\nUse this code to reset your password. It works once and expires in ${config.resetMinutes} minutes:\n\n${token}\n\nIf you didn't ask for this, you can ignore this email. Your password won't change.`,
      });
    },

    async confirmReset({ token, password }, { ip } = {}) {
      const r = await db.get(
        `SELECT pr.id, pr.user_id, pr.expires_at, pr.used_at, u.email FROM password_resets pr JOIN users u ON u.id = pr.user_id WHERE pr.token_hash = $1`,
        [hashToken(token)],
      );
      if (!r || r.used_at || r.expires_at <= now()) throw new HttpError(400, "reset_invalid", "That reset code is expired or already used. Request a new one.");
      const problem = passwordProblem(password, { email: r.email });
      if (problem) throw new HttpError(422, "invalid_input", "Some fields need fixing.", { fields: { password: problem } });
      const hash = await hashPassword(password);
      await db.tx(async (t) => {
        const at = now();
        const used = await t.run(`UPDATE password_resets SET used_at = $1 WHERE id = $2 AND used_at IS NULL`, [at, r.id]);
        if (!used.changes) throw new HttpError(400, "reset_invalid", "That reset code is expired or already used. Request a new one.");
        await t.run(`UPDATE users SET password_hash = $1, updated_at = $2 WHERE id = $3`, [hash, at, r.user_id]);
        await t.run(`UPDATE sessions SET revoked_at = $1 WHERE user_id = $2 AND revoked_at IS NULL`, [at, r.user_id]);
        await event(t, r.user_id, "password_reset", ip);
      });
    },

    async createAdmin({ email, password, firstName, lastName }) {
      const problem = passwordProblem(password, { email });
      if (problem) throw new Error(problem);
      const at = now();
      const id = newId();
      await db.run(
        `INSERT INTO users (id, role, email, password_hash, first_name, last_name, created_at, updated_at, email_verified_at) VALUES ($1, 'admin', $2, $3, $4, $5, $6, $6, $6)`,
        [id, email.trim().toLowerCase(), await hashPassword(password), firstName, lastName, at],
      );
      return id;
    },
  };
}
