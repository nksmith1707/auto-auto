// After-the-job endpoints: ratings, tips, damage claims, warranty returns, and the staff side of each.
import { readJson, send } from "../lib/http.js";
import { requireUser } from "../auth/routes.js";

const PHOTOS_MAX = 50 * 1024 * 1024; // Up to 6 photos as base64.

export function careRoutes(router, { auth, care, jobs }) {
  const who = async (req, roles) => (await requireUser(req, auth, roles)).user;

  // ---------- Customers ----------
  router.post("/v1/jobs/:id/rating", async (req, res) => { const u = await who(req, ["customer"]); send(res, 201, await care.rate(u, req.params.id, await readJson(req))); });
  router.post("/v1/jobs/:id/tip", async (req, res) => { const u = await who(req, ["customer"]); send(res, 201, await care.tip(u, req.params.id, await readJson(req))); });
  router.post("/v1/jobs/:id/warranty", async (req, res) => {
    const u = await who(req, ["customer"]);
    send(res, 201, { job: await jobs.requestWarranty(u, req.params.id, await readJson(req, { max: PHOTOS_MAX })) });
  });
  router.get("/v1/claims", async (req, res) => {
    const u = await who(req, ["customer", "partner"]);
    if (u.role === "customer") send(res, 200, { claims: await care.claimsForCustomer(u), jobs: await care.claimableJobs(u) });
    else send(res, 200, { claims: await care.claimsForPartner(u) });
  });
  router.post("/v1/claims", async (req, res) => { const u = await who(req, ["customer"]); send(res, 201, { claim: await care.fileClaim(u, await readJson(req, { max: PHOTOS_MAX })) }); });
  router.get("/v1/claims/:id", async (req, res) => {
    const u = await who(req, ["customer", "partner"]);
    send(res, 200, { claim: u.role === "customer" ? await care.claimForCustomer(u, req.params.id) : await care.claimForPartner(u, req.params.id) });
  });

  // ---------- Partners ----------
  router.post("/v1/claims/:id/respond", async (req, res) => { const u = await who(req, ["partner"]); send(res, 200, { claim: await care.respond(u, req.params.id, await readJson(req)) }); });
  router.post("/v1/jobs/:id/rate-customer", async (req, res) => { const u = await who(req, ["partner"]); send(res, 200, await care.rateCustomer(u, req.params.id, await readJson(req))); });
  router.post("/v1/jobs/:id/decline-warranty", async (req, res) => { const u = await who(req, ["partner"]); send(res, 200, await jobs.declineWarranty(u, req.params.id)); });
  router.get("/v1/partner/reviews", async (req, res) => send(res, 200, await care.reviewsFor(await who(req, ["partner"]))));

  // ---------- Staff ----------
  router.get("/v1/admin/claims", async (req, res) => { await who(req, ["admin"]); send(res, 200, { claims: await care.staffClaims(req.query.get("status") || "open") }); });
  router.get("/v1/admin/claims/:id", async (req, res) => { await who(req, ["admin"]); send(res, 200, { claim: await care.staffClaim(req.params.id) }); });
  router.post("/v1/admin/claims/:id/decision", async (req, res) => { const s = await who(req, ["admin"]); send(res, 200, { claim: await care.decideClaim(s, req.params.id, await readJson(req)) }); });
  router.get("/v1/admin/warranty", async (req, res) => { await who(req, ["admin"]); send(res, 200, { returns: await care.staffWarranty() }); });
  router.post("/v1/admin/warranty/:id/charge-back", async (req, res) => { const s = await who(req, ["admin"]); send(res, 200, { return: await care.setChargeBack(s, req.params.id, await readJson(req)) }); });
  router.get("/v1/admin/ratings", async (req, res) => { await who(req, ["admin"]); send(res, 200, { ratings: await care.staffRatings(req.query.get("filter") || "low") }); });
  router.post("/v1/admin/ratings/:id/follow-up", async (req, res) => { const s = await who(req, ["admin"]); send(res, 200, await care.followUp(s, req.params.id)); });
  router.post("/v1/admin/ratings/:id/hide", async (req, res) => { const s = await who(req, ["admin"]); send(res, 200, await care.hideReview(s, req.params.id, await readJson(req))); });
  router.get("/v1/admin/debts", async (req, res) => { await who(req, ["admin"]); send(res, 200, { debts: await care.staffDebts() }); });
  router.post("/v1/admin/debts/:id/waive", async (req, res) => { const s = await who(req, ["admin"]); send(res, 200, { debt: await care.waiveDebt(s, req.params.id, await readJson(req)) }); });
}
