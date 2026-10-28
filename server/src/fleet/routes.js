// Fleet endpoints: fleet managers (customer accounts), fleet-program partners, and staff.
import { readJson, send } from "../lib/http.js";
import { requireUser } from "../auth/routes.js";

const PHOTO_MAX = 9 * 1024 * 1024;

export function fleetRoutes(router, { auth, fleet }) {
  const who = async (req, roles) => (await requireUser(req, auth, roles)).user;
  const mgr = (req) => who(req, ["customer"]);
  const ptr = (req) => who(req, ["partner"]);
  const staff = (req) => who(req, ["admin"]);

  // ---------- Fleet managers ----------
  router.get("/v1/fleet", async (req, res) => send(res, 200, await fleet.overview(await mgr(req))));
  router.post("/v1/fleet", async (req, res) => { const u = await mgr(req); send(res, 201, await fleet.create(u, await readJson(req))); });
  router.patch("/v1/fleet", async (req, res) => { const u = await mgr(req); send(res, 200, await fleet.update(u, await readJson(req))); });
  router.post("/v1/fleet/vehicles", async (req, res) => { const u = await mgr(req); send(res, 201, await fleet.addVehicle(u, await readJson(req))); });
  router.patch("/v1/fleet/vehicles/:id", async (req, res) => { const u = await mgr(req); send(res, 200, await fleet.updateVehicle(u, req.params.id, await readJson(req))); });
  router.delete("/v1/fleet/vehicles/:id", async (req, res) => { const u = await mgr(req); send(res, 200, await fleet.removeVehicle(u, req.params.id)); });
  router.get("/v1/fleet/vehicles/:id/log", async (req, res) => { const u = await mgr(req); send(res, 200, await fleet.vehicleLog(u, req.params.id)); });
  router.post("/v1/fleet/estimate", async (req, res) => { const u = await mgr(req); send(res, 200, { estimate: await fleet.estimate(u, await readJson(req)) }); });
  router.post("/v1/fleet/runs", async (req, res) => { const u = await mgr(req); send(res, 201, { run: await fleet.postRun(u, await readJson(req)) }); });
  router.get("/v1/fleet/runs/:id", async (req, res) => { const u = await mgr(req); send(res, 200, { run: await fleet.getRun(u, req.params.id) }); });
  router.post("/v1/fleet/runs/:id/cancel", async (req, res) => { const u = await mgr(req); send(res, 200, { run: await fleet.cancelRun(u, req.params.id, await readJson(req)) }); });
  router.post("/v1/fleet/addons/:id/approve", async (req, res) => { const u = await mgr(req); send(res, 200, await fleet.decideAddon(u, req.params.id, true)); });
  router.post("/v1/fleet/addons/:id/decline", async (req, res) => { const u = await mgr(req); send(res, 200, await fleet.decideAddon(u, req.params.id, false)); });
  router.get("/v1/fleet/invoices/:id", async (req, res) => { const u = await mgr(req); send(res, 200, { invoice: await fleet.invoice(u, req.params.id) }); });
  router.post("/v1/fleet/invoices/:id/pay", async (req, res) => { const u = await mgr(req); send(res, 200, { invoice: await fleet.payInvoice(u, req.params.id) }); });

  // ---------- Partners ----------
  router.get("/v1/fleet-runs", async (req, res) => send(res, 200, await fleet.partnerHome(await ptr(req))));
  router.get("/v1/fleet-runs/:id", async (req, res) => { const u = await ptr(req); send(res, 200, { run: await fleet.partnerGetRun(u, req.params.id) }); });
  router.post("/v1/fleet-runs/:id/claim", async (req, res) => { const u = await ptr(req); send(res, 200, { run: await fleet.claim(u, req.params.id) }); });
  router.post("/v1/fleet-runs/:id/release", async (req, res) => { const u = await ptr(req); send(res, 200, await fleet.release(u, req.params.id)); });
  router.post("/v1/fleet-runs/:id/start", async (req, res) => { const u = await ptr(req); send(res, 200, { run: await fleet.start(u, req.params.id) }); });
  router.post("/v1/fleet-runs/:id/finish", async (req, res) => { const u = await ptr(req); send(res, 200, { run: await fleet.finish(u, req.params.id) }); });
  router.post("/v1/fleet-runs/:id/vehicles/:rv/photos", async (req, res) => { const u = await ptr(req); send(res, 201, { photos: await fleet.photo(u, req.params.id, req.params.rv, await readJson(req, { max: PHOTO_MAX })) }); });
  router.post("/v1/fleet-runs/:id/vehicles/:rv/photos/:slot/damage", async (req, res) => { const u = await ptr(req); send(res, 200, { photos: await fleet.damage(u, req.params.id, req.params.rv, req.params.slot, await readJson(req)) }); });
  router.post("/v1/fleet-runs/:id/vehicles/:rv/check-in", async (req, res) => { const u = await ptr(req); send(res, 200, { run: await fleet.checkIn(u, req.params.id, req.params.rv, await readJson(req)) }); });
  router.post("/v1/fleet-runs/:id/vehicles/:rv/addons", async (req, res) => { const u = await ptr(req); send(res, 200, { run: await fleet.requestAddons(u, req.params.id, req.params.rv, await readJson(req)) }); });
  router.post("/v1/fleet-runs/:id/vehicles/:rv/done", async (req, res) => { const u = await ptr(req); send(res, 200, { run: await fleet.vehicleDone(u, req.params.id, req.params.rv, await readJson(req)) }); });
  router.post("/v1/fleet-runs/:id/vehicles/:rv/skip", async (req, res) => { const u = await ptr(req); send(res, 200, { run: await fleet.skipVehicle(u, req.params.id, req.params.rv, await readJson(req)) }); });

  // ---------- Staff ----------
  router.get("/v1/admin/fleets", async (req, res) => { await staff(req); send(res, 200, { fleets: await fleet.staffList() }); });
  router.post("/v1/admin/fleets/:id/decision", async (req, res) => { const s = await staff(req); send(res, 200, { fleet: await fleet.staffDecide(s, req.params.id, await readJson(req)) }); });
  router.get("/v1/admin/fleet-invoices", async (req, res) => { await staff(req); send(res, 200, { invoices: await fleet.staffInvoices(req.query.get("status") || "all") }); });
  router.post("/v1/admin/fleet-invoices/:id/paid", async (req, res) => { const s = await staff(req); send(res, 200, { invoice: await fleet.staffMarkPaid(s, req.params.id, await readJson(req)) }); });
  router.get("/v1/admin/fleet-runs", async (req, res) => { await staff(req); send(res, 200, { runs: await fleet.staffRuns() }); });
  router.get("/v1/admin/fleet-runs/:id", async (req, res) => { await staff(req); send(res, 200, { run: await fleet.staffRun(req.params.id) }); });
}
