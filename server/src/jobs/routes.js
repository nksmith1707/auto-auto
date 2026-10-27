// Job endpoints for customers, partners, and staff.
import { readJson, send, HttpError } from "../lib/http.js";
import { requireUser } from "../auth/routes.js";

export function jobRoutes(router, { db, auth, jobs, now = () => Date.now() }) {
  // Time-based changes (expired requests, approvals that ran out) are applied before anyone looks at jobs.
  let lastSweep = 0;
  const fresh = async () => { if (now() - lastSweep > 1000) { lastSweep = now(); await jobs.sweep(); } };
  const who = async (req, roles) => { const s = await requireUser(req, auth, roles); await fresh(); return s.user; };

  // ---------- Customers and partners ----------
  router.get("/v1/jobs", async (req, res) => {
    const u = await who(req, ["customer", "partner"]);
    send(res, 200, { jobs: u.role === "customer" ? await jobs.listForCustomer(u) : await jobs.listForPartner(u) });
  });

  router.get("/v1/jobs/board", async (req, res) => {
    const u = await who(req, ["partner"]);
    send(res, 200, await jobs.board(u));
  });

  router.get("/v1/jobs/offers", async (req, res) => {
    const u = await who(req, ["partner"]);
    send(res, 200, { offers: await jobs.offersFor(u) });
  });

  router.get("/v1/jobs/:id/messages", async (req, res) => {
    const u = await who(req, ["customer", "partner"]);
    send(res, 200, await jobs.messages(u, req.params.id));
  });

  router.post("/v1/jobs/:id/messages", async (req, res) => {
    const u = await who(req, ["customer", "partner"]);
    send(res, 201, await jobs.sendMessage(u, req.params.id, await readJson(req)));
  });

  router.post("/v1/jobs/:id/decline-offer", async (req, res) => {
    const u = await who(req, ["partner"]);
    send(res, 200, await jobs.declineOffer(u, req.params.id));
  });

  router.get("/v1/jobs/:id", async (req, res) => {
    const u = await who(req, ["customer", "partner"]);
    send(res, 200, { job: u.role === "customer" ? await jobs.getForCustomer(u, req.params.id) : await jobs.getForPartner(u, req.params.id) });
  });

  router.post("/v1/jobs/:id/cancel", async (req, res) => {
    const u = await who(req, ["customer", "partner"]);
    const b = await readJson(req);
    if (u.role === "customer") send(res, 200, { job: await jobs.cancelByCustomer(u, req.params.id, b) });
    else send(res, 200, await jobs.cancelByPartner(u, req.params.id, b));
  });

  // ---------- Customers ----------
  router.post("/v1/jobs", async (req, res) => {
    const u = await who(req, ["customer"]);
    send(res, 201, { job: await jobs.book(u, await readJson(req)) });
  });
  router.post("/v1/jobs/:id/approve-partner", async (req, res) => {
    const u = await who(req, ["customer"]);
    send(res, 200, { job: await jobs.decidePartner(u, req.params.id, true) });
  });
  router.post("/v1/jobs/:id/decline-partner", async (req, res) => {
    const u = await who(req, ["customer"]);
    send(res, 200, { job: await jobs.decidePartner(u, req.params.id, false) });
  });
  router.post("/v1/jobs/:id/addons/:addonId/approve", async (req, res) => {
    const u = await who(req, ["customer"]);
    send(res, 200, { job: await jobs.decideAddon(u, req.params.id, req.params.addonId, true) });
  });
  router.post("/v1/jobs/:id/addons/:addonId/decline", async (req, res) => {
    const u = await who(req, ["customer"]);
    send(res, 200, { job: await jobs.decideAddon(u, req.params.id, req.params.addonId, false) });
  });
  router.post("/v1/jobs/:id/reschedule", async (req, res) => {
    const u = await who(req, ["customer"]);
    send(res, 200, { job: await jobs.reschedule(u, req.params.id, await readJson(req)) });
  });
  router.post("/v1/jobs/:id/switch-partner", async (req, res) => {
    const u = await who(req, ["customer"]);
    send(res, 200, { job: await jobs.switchPartner(u, req.params.id) });
  });

  // ---------- Partners ----------
  const partnerAction = (path, fn, withBody = false) => router.post(`/v1/jobs/:id/${path}`, async (req, res) => {
    const u = await who(req, ["partner"]);
    const b = withBody ? await readJson(req) : undefined;
    send(res, 200, { job: await fn(u, req.params.id, b) });
  });
  partnerAction("accept", jobs.accept);
  partnerAction("start-trip", jobs.startTrip);
  partnerAction("arrive", jobs.arrive);
  partnerAction("check-in", jobs.checkIn, true);
  partnerAction("no-show", jobs.noShow);
  partnerAction("addons", jobs.requestAddons, true);
  partnerAction("glass-quote", jobs.glassQuote, true);
  partnerAction("complete", jobs.complete, true);

  // ---------- Staff ----------
  router.get("/v1/admin/partners", async (req, res) => {
    await requireUser(req, auth, ["admin"]);
    const rows = await db.all(
      `SELECT u.id, u.email, u.first_name, u.last_name, u.phone, u.created_at, p.status, p.status_reason, p.review_reason
       FROM users u JOIN partner_profiles p ON p.user_id = u.id ORDER BY u.created_at DESC LIMIT 500`,
    );
    send(res, 200, { partners: rows.map((r) => ({ id: r.id, email: r.email, name: `${r.first_name} ${r.last_name}`, phone: r.phone, createdAt: r.created_at, status: r.status, statusReason: r.status_reason, reviewReason: r.review_reason })) });
  });

  router.post("/v1/admin/partners/:id/status", async (req, res) => {
    const s = await requireUser(req, auth, ["admin"]);
    const b = await readJson(req);
    const statuses = ["applicant", "in_review", "active", "paused", "deactivated"];
    if (!statuses.includes(b.status)) throw new HttpError(422, "invalid_input", "Some fields need fixing.", { fields: { status: `Choose one of: ${statuses.join(", ")}.` } });
    const reason = typeof b.reason === "string" ? b.reason.trim().slice(0, 300) : "";
    if (["paused", "deactivated"].includes(b.status) && reason.length < 5) throw new HttpError(422, "invalid_input", "Some fields need fixing.", { fields: { reason: "Say why. The partner sees this reason." } });
    const r = await db.run(`UPDATE partner_profiles SET status = $1, status_reason = $2, review_reason = CASE WHEN $1 = 'active' THEN NULL ELSE review_reason END, updated_at = $3 WHERE user_id = $4`,
      [b.status, reason || null, now(), req.params.id]);
    if (!r.changes) throw new HttpError(404, "not_found", "No partner with that ID.");
    await db.run(`INSERT INTO auth_events (id, user_id, kind, ip, created_at) VALUES ($1, $2, $3, NULL, $4)`, [crypto.randomUUID(), req.params.id, `partner_status:${b.status}:by:${s.user.id}`, now()]);
    send(res, 200, { ok: true, status: b.status });
  });
}
