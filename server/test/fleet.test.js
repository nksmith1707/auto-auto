import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startTestApp, customer, partner } from "./helpers.js";

const HOUR = 3_600_000, DAY = 24 * HOUR;
let clock = Date.parse("2026-11-02T13:00:00Z");
let app, mgr, mgr2, pa, pb, admin, fleetId;
const veh = {};

const call = (m, p, token, body) => app.call(m, p, { token, body });
const ok = async (m, p, token, body, status = 200) => {
  const r = await call(m, p, token, body);
  assert.equal(r.status, status, `${m} ${p} → ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
};
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(100, 7)]).toString("base64");
const CHECKIN = ["e0", "e1", "e2", "e3", "e4", "e5", "e6", "e7", "i0", "i1", "i2", "i3"];
const INSPECTION = Object.fromEntries(["brakes", "tires", "fluids", "battery", "wipers", "lights", "belts_hoses", "filters"].map((k) => [k, { status: "good" }]));
const ACCOUNT = {
  name: "Smoky Mountain Plumbing", managerName: "Rick Alvarez", billingEmail: "ap@smokyplumbing.com",
  yardStreet: "1420 Sutherland Ave", yardCity: "Knoxville", yardState: "TN", yardZip: "37919", yardHours: "Mon–Sat, 6 AM – 6 PM",
  checkinNotes: "Check in at the dispatch window. Keys are in the lockbox.", terms: "net30", autoApproveCents: 5000, poRequired: true,
};

async function joinFleetProgram(token) {
  await ok("PUT", "/v1/onboarding/steps/business", token, { legalFirst: "Amanda", legalLast: "Smith" });
  await ok("POST", "/v1/onboarding/sign", token, { docId: "esign" });
  await ok("POST", "/v1/onboarding/sign", token, { docId: "fleet", name: "Amanda Smith" });
}

before(async () => {
  app = await startTestApp({ REQUIRE_JOB_PHOTOS: "on" }, { now: () => clock });
  mgr = (await call("POST", "/v1/auth/signup", null, customer({ email: "rick@smokyplumbing.com" }))).body.token;
  mgr2 = (await call("POST", "/v1/auth/signup", null, customer({ email: "other@example.com" }))).body.token;
  const a = await call("POST", "/v1/auth/signup", null, partner({ email: "fl-a@example.com" }));
  pa = a.body.token;
  const b = await call("POST", "/v1/auth/signup", null, partner({ email: "fl-b@example.com" }));
  pb = b.body.token;
  const ad = await call("POST", "/v1/auth/signup", null, customer({ email: "fl-ops@example.com" }));
  await app.db.run(`UPDATE users SET role = 'admin' WHERE id = $1`, [ad.body.user.id]);
  admin = ad.body.token;
  for (const [t, id] of [[pa, a.body.user.id], [pb, b.body.user.id]]) {
    await ok("POST", `/v1/admin/partners/${id}/status`, admin, { status: "active" });
    await ok("PUT", "/v1/partner/services", t, { serviceIds: ["oil_change", "air_filters", "brakes", "fleet_wash"] });
  }
});
after(async () => { await app.close(); });

test("business account: checked fields; net 30 waits for a credit check; staff approve with a limit and rate", async () => {
  const none = await ok("GET", "/v1/fleet", mgr);
  assert.equal(none.fleet, null);
  assert.ok(none.services.some((s) => s.id === "dot_annual"), "DOT services are offered to fleets");
  assert.ok(!none.services.some((s) => s.id === "quick_wipers"), "quick fixes aren't fleet services");
  assert.equal(none.rates.tripFeeCents, 2500);
  const bad = await call("POST", "/v1/fleet", mgr, { ...ACCOUNT, checkinNotes: "lockbox" });
  assert.equal(bad.status, 422);
  assert.match(bad.body.error.fields.checkinNotes, /check in/);
  assert.equal((await call("POST", "/v1/fleet", mgr, { ...ACCOUNT, autoApproveCents: 1234 })).status, 422);
  const f = await ok("POST", "/v1/fleet", mgr, ACCOUNT, 201);
  fleetId = f.fleet.id;
  assert.equal(f.fleet.status, "review");
  assert.equal(f.fleet.laborRate, 85);
  assert.equal((await call("POST", "/v1/fleet", mgr, ACCOUNT)).status, 409, "one business account per login");

  assert.equal((await call("POST", `/v1/admin/fleets/${fleetId}/decision`, admin, { decision: "approve" })).status, 422, "net 30 needs a credit limit");
  assert.equal((await call("POST", `/v1/admin/fleets/${fleetId}/decision`, mgr, { decision: "approve" })).status, 403);
  const appr = await ok("POST", `/v1/admin/fleets/${fleetId}/decision`, admin, { decision: "approve", creditLimitCents: 150000, laborRate: 82 });
  assert.equal(appr.fleet.status, "active");
  assert.equal(appr.fleet.laborRate, 82);
});

test("vehicles: unit numbers, classes, and VINs are checked", async () => {
  assert.equal((await call("POST", "/v1/fleet/vehicles", mgr2, { unit: "1", year: 2020, make: "Ford", model: "Transit", vehicleClass: "van_pickup" })).status, 404, "needs a business account");
  let f = await ok("POST", "/v1/fleet/vehicles", mgr, { unit: "Unit 104", year: 2019, make: "Ford", model: "Transit 250", vehicleClass: "van_pickup", plate: "4kd-112", mileage: "61,240" }, 201);
  assert.equal((await call("POST", "/v1/fleet/vehicles", mgr, { unit: "unit 104", year: 2020, make: "Ford", model: "Transit", vehicleClass: "van_pickup" })).status, 422, "unit numbers are unique");
  assert.equal((await call("POST", "/v1/fleet/vehicles", mgr, { unit: "U9", year: 2020, make: "Ford", model: "Transit", vehicleClass: "bus" })).status, 422);
  assert.equal((await call("POST", "/v1/fleet/vehicles", mgr, { unit: "U9", year: 2020, make: "Ford", model: "Transit", vehicleClass: "van_pickup", vin: "IOQ" })).status, 422);
  await ok("POST", "/v1/fleet/vehicles", mgr, { unit: "Unit 111", year: 2021, make: "Ram", model: "ProMaster", vehicleClass: "van_pickup", mileage: 40220 }, 201);
  f = await ok("POST", "/v1/fleet/vehicles", mgr, { unit: "Trailer 7", year: 2018, make: "Big Tex", model: "14LP", vehicleClass: "trailer" }, 201);
  for (const v of f.vehicles) veh[v.unit] = v;
  assert.equal(veh["Unit 104"].plate, "4KD-112");
  assert.equal(veh["Unit 104"].nextOilMiles, 66240);
  assert.equal(veh["Unit 104"].classLabel, "Van or pickup");
});

test("estimate: fleet rate, parts + 10%, services that don't fit a class are skipped, one trip fee", async () => {
  const e = (await ok("POST", "/v1/fleet/estimate", mgr, { vehicleIds: [veh["Unit 104"].id, veh["Trailer 7"].id], serviceIds: ["oil_change", "fleet_wash"] })).estimate;
  const van = e.vehicles.find((v) => v.unit === "Unit 104");
  const oil = van.lines.find((l) => l.serviceId === "oil_change");
  assert.equal(oil.priceCents, Math.round(0.4 * 82 * 100) + Math.round(31 * 1.1 * 100), "book time × $82 + parts at cost + 10%");
  assert.equal(oil.partsCostCents, undefined, "managers don't see parts cost");
  const trailer = e.vehicles.find((v) => v.unit === "Trailer 7");
  assert.deepEqual(trailer.skipped.map((x) => x.serviceId), ["oil_change"]);
  assert.equal(e.tripFeeCents, 2500);
  assert.equal(e.totalCents, van.subtotalCents + trailer.subtotalCents + 2500);
});

let run;
test("post a visit: PO required, credit limit enforced; partners see it only after joining the fleet program", async () => {
  const body = { vehicleIds: [veh["Unit 104"].id, veh["Unit 111"].id], serviceIds: ["oil_change"], windowStart: clock + 2 * DAY };
  const r = await call("POST", "/v1/fleet/runs", mgr, body);
  assert.equal(r.status, 422);
  assert.match(r.body.error.fields.po, /PO number/);
  run = (await ok("POST", "/v1/fleet/runs", mgr, { ...body, po: "PO-SMP-10442" }, 201)).run;
  assert.equal(run.status, "posted");
  assert.equal(run.number, 1001);
  assert.equal(run.vehicles.length, 2);
  assert.equal(run.cancelPreview.feeCents, 0);

  let home = await ok("GET", "/v1/fleet-runs", pa);
  assert.equal(home.needsAddendum, true);
  assert.equal(home.open.length, 0);
  assert.equal((await call("POST", `/v1/fleet-runs/${run.id}/claim`, pa)).status, 403);
  await joinFleetProgram(pa);
  home = await ok("GET", "/v1/fleet-runs", pa);
  assert.equal(home.enrolled, true);
  assert.equal(home.open.length, 1);
  const seen = home.open[0];
  assert.equal(seen.fleet.yard.street, "1420 Sutherland Ave", "business yards aren't hidden");
  assert.match(seen.fleet.checkinNotes, /lockbox/);
  assert.equal(seen.pay.visitFeeCents, 2500, "the trip fee goes to the partner");
  assert.ok(seen.pay.earningsCents > 0);

  // Too big for the remaining credit.
  const many = [];
  for (let i = 0; i < 20; i++) many.push((await ok("POST", "/v1/fleet/vehicles", mgr, { unit: `Box ${i}`, year: 2020, make: "Isuzu", model: "NPR", vehicleClass: "box_truck", mileage: 50000 }, 201)).vehicles.find((v) => v.unit === `Box ${i}`).id);
  const over = await call("POST", "/v1/fleet/runs", mgr, { vehicleIds: many, serviceIds: ["brakes"], windowStart: clock + 3 * DAY, po: "PO-1" });
  assert.equal(over.status, 409);
  assert.match(over.body.error.message, /credit limit/);
});

test("a fleet visit: claim, start, per-vehicle photos and check-in, auto-approved and manager-approved add-ons, finish, invoice", async () => {
  const c = await ok("POST", `/v1/fleet-runs/${run.id}/claim`, pa);
  assert.equal(c.run.status, "claimed");
  assert.equal((await call("POST", `/v1/fleet-runs/${run.id}/claim`, pb)).status, 403, "partner B hasn't joined the fleet program");
  assert.equal((await call("POST", `/v1/fleet-runs/${run.id}/start`, pa)).status, 409, "too early");
  clock = run.windowStart - HOUR;
  let r = (await ok("POST", `/v1/fleet-runs/${run.id}/start`, pa)).run;
  assert.equal(r.status, "active");
  const [v1, v2] = r.vehicles;
  assert.equal(v1.status, "checkin");

  const base = `/v1/fleet-runs/${run.id}/vehicles/${v1.id}`;
  let x = await call("POST", `${base}/check-in`, pa, { odometer: 61900 });
  assert.equal(x.status, 409);
  assert.match(x.body.error.message, /12 check-in photos/);
  assert.equal((await call("POST", `${base}/photos`, pb, { slot: "e0", contentType: "image/jpeg", data: JPG })).status, 404);
  for (const s of CHECKIN) await ok("POST", `${base}/photos`, pa, { slot: s, contentType: "image/jpeg", data: JPG }, 201);
  await ok("POST", `${base}/photos/e4/damage`, pa, { note: "Dent in rear door" });
  r = (await ok("POST", `${base}/check-in`, pa, { odometer: 61900 })).run;
  assert.equal(r.vehicles[0].status, "service");

  // $34 air filters fits under the $50 auto-approve limit; brakes don't.
  r = (await ok("POST", `${base}/addons`, pa, { serviceIds: ["air_filters"], reason: "Engine air filter is clogged" })).run;
  assert.equal(r.vehicles[0].addons[0].status, "approved");
  assert.equal(r.vehicles[0].addons[0].autoApproved, true);
  r = (await ok("POST", `${base}/addons`, pa, { serviceIds: ["brakes"], reason: "Front pads at 2 mm, rotors scored" })).run;
  const brakes = r.vehicles[0].addons.find((a) => a.serviceId === "brakes");
  assert.equal(brakes.status, "pending");
  x = await call("POST", `${base}/done`, pa, { inspection: INSPECTION, notes: "Oil and filter changed." });
  assert.equal(x.status, 409);
  assert.match(x.body.error.message, /waiting for the fleet manager/);
  const ov = await ok("GET", "/v1/fleet", mgr);
  assert.equal(ov.approvals.find((a) => a.id === brakes.id).status, "pending");
  await ok("POST", `/v1/fleet/addons/${brakes.id}/approve`, mgr);

  x = await call("POST", `${base}/done`, pa, { inspection: INSPECTION, notes: "Oil and filter changed." });
  assert.match(x.body.error.message, /after photos/);
  for (const s of ["a0", "a1"]) await ok("POST", `${base}/photos`, pa, { slot: s, contentType: "image/jpeg", data: JPG }, 201);
  assert.equal((await call("POST", `${base}/done`, pa, { inspection: INSPECTION, notes: "ok" })).status, 422, "a real note for the maintenance log");
  r = (await ok("POST", `${base}/done`, pa, { inspection: INSPECTION, notes: "Oil and filter changed, pads and rotors replaced. Next oil at 66,900." })).run;
  assert.equal(r.vehicles[0].status, "done");

  assert.equal((await call("POST", `/v1/fleet-runs/${run.id}/finish`, pa)).status, 409, "the second vehicle isn't finished");
  assert.equal((await call("POST", `/v1/fleet-runs/${run.id}/vehicles/${v2.id}/skip`, pa, { reason: "x" })).status, 422);
  await ok("POST", `/v1/fleet-runs/${run.id}/vehicles/${v2.id}/skip`, pa, { reason: "Not in the yard (out on a call)" });
  r = (await ok("POST", `/v1/fleet-runs/${run.id}/finish`, pa)).run;
  assert.equal(r.status, "completed");

  // One invoice: the serviced vehicle, its add-ons, and one trip fee. Net 30.
  const m = (await ok("GET", `/v1/fleet/runs/${run.id}`, mgr)).run;
  assert.ok(m.invoice);
  const inv = (await ok("GET", `/v1/fleet/invoices/${m.invoice.id}`, mgr)).invoice;
  assert.equal(inv.number, 2001);
  assert.equal(inv.po, "PO-SMP-10442");
  assert.deepEqual(inv.lines.map((l) => l.label), ["Unit 104 · Oil change", "Unit 104 · Add-on: Air filters", "Unit 104 · Add-on: Brakes", "Trip fee (one per visit)"]);
  assert.equal(inv.totalCents, inv.lines.reduce((a, l) => a + l.cents, 0));
  assert.equal(inv.dueAt - inv.issuedAt, 30 * DAY);
  assert.equal(inv.status, "open");

  // Partner paid now (ledger), whether or not the fleet has paid.
  const p = await ok("GET", "/v1/payouts", pa);
  assert.ok(p.activity.some((a) => a.kind === "earnings" && /Fleet visit #1001/.test(a.note)));

  // Vehicle log and what's due next.
  const ov2 = await ok("GET", "/v1/fleet", mgr);
  const u104 = ov2.vehicles.find((v) => v.unit === "Unit 104");
  assert.equal(u104.mileage, 61900);
  assert.equal(u104.nextOilMiles, 66900);
  const logb = await ok("GET", `/v1/fleet/vehicles/${u104.id}/log`, mgr);
  assert.equal(logb.entries.length, 1);
  assert.deepEqual(logb.entries[0].services, ["Oil change", "Air filters", "Brakes"]);
  assert.equal(logb.entries[0].photos.checkin.length, 12);
  assert.equal(logb.entries[0].photos.damage[0].note, "Dent in rear door");
  assert.equal(ov2.openInvoicesCents, inv.totalCents);
  assert.equal(ov2.creditAvailableCents, 150000 - inv.totalCents);
  assert.equal((await call("GET", `/v1/fleet/invoices/${inv.id}`, mgr2)).status, 404);

  // Staff record a check payment.
  assert.equal((await call("POST", `/v1/fleet/invoices/${inv.id}/pay`, mgr)).status, 503, "card payments are off on this server");
  const paid = await ok("POST", `/v1/admin/fleet-invoices/${inv.id}/paid`, admin, { note: "Check #4471" });
  assert.equal(paid.invoice.status, "paid");
  assert.equal((await ok("GET", "/v1/admin/fleet-invoices?status=open", admin)).invoices.length, 0);
});

test("cancelling: free before a partner is within 24 hours; then the trip fee, which goes to the partner", async () => {
  const body = { vehicleIds: [veh["Unit 111"].id], serviceIds: ["oil_change"], windowStart: clock + 20 * HOUR, po: "PO-2" };
  const free = (await ok("POST", "/v1/fleet/runs", mgr, body, 201)).run;
  assert.equal((await ok("POST", `/v1/fleet/runs/${free.id}/cancel`, mgr, { expectedFeeCents: 0 })).run.cancelFeeCents, 0);
  const late = (await ok("POST", "/v1/fleet/runs", mgr, body, 201)).run;
  await ok("POST", `/v1/fleet-runs/${late.id}/claim`, pa);
  const view = (await ok("GET", `/v1/fleet/runs/${late.id}`, mgr)).run;
  assert.equal(view.partner.name, "Amanda S.");
  assert.equal(view.cancelPreview.feeCents, 2500);
  assert.equal((await call("POST", `/v1/fleet/runs/${late.id}/cancel`, mgr, { expectedFeeCents: 0 })).status, 409);
  const c = (await ok("POST", `/v1/fleet/runs/${late.id}/cancel`, mgr, { expectedFeeCents: 2500 })).run;
  assert.equal(c.status, "cancelled");
  assert.equal(c.invoice.totalCents, 2500);
  const p = await ok("GET", "/v1/payouts", pa);
  assert.ok(p.activity.some((a) => a.kind === "fee_share" && a.cents === 2500));
});

test("partners can release a claimed visit; it goes back out without them", async () => {
  const r = (await ok("POST", "/v1/fleet/runs", mgr, { vehicleIds: [veh["Unit 111"].id], serviceIds: ["oil_change"], windowStart: clock + 5 * DAY, po: "PO-3" }, 201)).run;
  await ok("POST", `/v1/fleet-runs/${r.id}/claim`, pa);
  const rel = await ok("POST", `/v1/fleet-runs/${r.id}/release`, pa);
  assert.equal(rel.late, false);
  assert.ok(!(await ok("GET", "/v1/fleet-runs", pa)).open.some((x) => x.id === r.id), "not offered to the same partner again");
  assert.equal((await ok("GET", `/v1/fleet/runs/${r.id}`, mgr)).run.status, "posted");
});

test("staff see fleets, visits, and can pause an account", async () => {
  const list = (await ok("GET", "/v1/admin/fleets", admin)).fleets;
  assert.equal(list[0].name, "Smoky Mountain Plumbing");
  assert.equal(list[0].vehicles, 23);
  assert.ok((await ok("GET", "/v1/admin/fleet-runs", admin)).runs.length >= 3);
  assert.equal((await call("POST", `/v1/admin/fleets/${fleetId}/decision`, admin, { decision: "pause" })).status, 422);
  await ok("POST", `/v1/admin/fleets/${fleetId}/decision`, admin, { decision: "pause", note: "Invoices past due." });
  const r = await call("POST", "/v1/fleet/runs", mgr, { vehicleIds: [veh["Unit 111"].id], serviceIds: ["oil_change"], windowStart: clock + 5 * DAY, po: "PO-4" });
  assert.equal(r.status, 409);
});
