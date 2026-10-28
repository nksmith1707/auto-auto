import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startTestApp, customer, partner, approveProof } from "./helpers.js";

const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;
let clock = Date.parse("2026-11-02T13:00:00Z");
let app, cust, cust2, pa, pb, pc, admin, vehicleId, placeId, paId;

const call = (m, p, token, body) => app.call(m, p, { token, body });
const ok = async (m, p, token, body, status = 200) => {
  const r = await call(m, p, token, body);
  assert.equal(r.status, status, `${m} ${p} → ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
};
const book = (over = {}) => ok("POST", "/v1/jobs", cust, { vehicleId, placeId, serviceIds: ["oil_change"], kind: "scheduled", windowStart: clock + 3 * DAY, ...over }, 201).then((b) => b.job);
const tick = (ms) => { clock += ms; };
const INSPECTION = Object.fromEntries(["brakes", "tires", "fluids", "battery", "wipers", "lights", "belts_hoses", "filters"].map((k) => [k, { status: "good" }]));

before(async () => {
  app = await startTestApp({}, { now: () => clock });
  cust = (await call("POST", "/v1/auth/signup", null, customer({ email: "jobs@example.com" }))).body.token;
  cust2 = (await call("POST", "/v1/auth/signup", null, customer({ email: "jobs2@example.com" }))).body.token;
  const a = await call("POST", "/v1/auth/signup", null, partner({ email: "pa@example.com", firstName: "Amanda", lastName: "Smith" }));
  pa = a.body.token; paId = a.body.user.id;
  const b = await call("POST", "/v1/auth/signup", null, partner({ email: "pb@example.com", firstName: "Ben", lastName: "Cole" }));
  pb = b.body.token;
  pc = (await call("POST", "/v1/auth/signup", null, partner({ email: "pc@example.com" }))).body.token;
  const ad = await call("POST", "/v1/auth/signup", null, customer({ email: "ops@example.com" }));
  await app.db.run(`UPDATE users SET role = 'admin' WHERE id = $1`, [ad.body.user.id]);
  admin = ad.body.token;
  for (const [t, id] of [[pa, a.body.user.id], [pb, b.body.user.id]]) {
    await ok("POST", `/v1/admin/partners/${id}/status`, admin, { status: "active" });
    await ok("PUT", "/v1/partner/services", t, { serviceIds: ["oil_change", "tire_rotation", "brakes", "air_filters", "jump_start", "glass_windshield", "diagnostics"] });
    await approveProof(app.db, id);
  }
  await ok("PUT", "/v1/partner/services", pc, { serviceIds: ["oil_change"] });
  vehicleId = (await ok("POST", "/v1/vehicles", cust, { year: 2015, make: "Honda", model: "Civic", mileage: 84000 }, 201)).vehicle.id;
  placeId = (await ok("POST", "/v1/places", cust, { label: "Home", street: "123 Kingston Pike", city: "Knoxville", state: "TN", zip: "37919", notes: "Gate code 4411" }, 201)).place.id;
});
after(async () => { await app.close(); });

test("booking checks everything and locks the price with its settings version", async () => {
  const bad = async (over, field, re) => {
    const r = await call("POST", "/v1/jobs", cust, { vehicleId, placeId, serviceIds: ["oil_change"], kind: "scheduled", windowStart: clock + DAY, ...over });
    assert.equal(r.status, 422, JSON.stringify(r.body));
    assert.match(r.body.error.fields[field], re);
  };
  await bad({ vehicleId: "nope" }, "vehicleId", /your vehicles/);
  await bad({ placeId: "nope" }, "placeId", /meet you/);
  await bad({ serviceIds: [] }, "serviceIds", /at least one/);
  await bad({ serviceIds: ["dot_annual"] }, "serviceIds", /fleet account/);
  await bad({ kind: "roadside", serviceIds: ["oil_change"] }, "serviceIds", /only include roadside/);
  await bad({ windowStart: clock + HOUR }, "windowStart", /at least 2 hours/);
  await bad({ windowStart: clock + 40 * DAY }, "windowStart", /30 days ahead/);
  await bad({ kind: "teleport" }, "kind", /scheduled visit/);
  const other = await call("POST", "/v1/jobs", cust2, { vehicleId, placeId, serviceIds: ["oil_change"], kind: "asap" });
  assert.equal(other.status, 422, "can't book with someone else's vehicle");

  const job = await book({ serviceIds: ["oil_change", "brakes"], notes: "Blue house" });
  assert.equal(job.status, "requested");
  assert.equal(job.settingsVersion, 1);
  assert.equal(job.quote.totalCents, 8000 + 35300 + 1800);
  assert.equal(job.quote.depositCents, 18100, "parts cost ($31 + $150) beats 25% of the total");
  assert.equal(job.quote.lines[0].partsCostCents, undefined, "customers don't see parts cost");
  assert.equal(job.windowEnd - job.windowStart, 2 * HOUR);
  assert.deepEqual(job.timeline.map((e) => e.kind), ["booked"]);
  await ok("POST", `/v1/jobs/${job.id}/cancel`, cust, {});
});

test("job board: only approved partners who offer every service; address stays hidden", async () => {
  const job = await book();
  const blocked = await ok("GET", "/v1/jobs/board", pc);
  assert.match(blocked.blocked, /approved/);
  assert.equal(blocked.jobs.length, 0);
  const board = await ok("GET", "/v1/jobs/board", pa);
  const j = board.jobs.find((x) => x.id === job.id);
  assert.ok(j);
  assert.equal(j.area, "Knoxville, TN 37919");
  assert.equal(j.place, null, "no street address before Start Trip");
  assert.equal(JSON.stringify(j).includes("Kingston"), false);
  assert.equal(JSON.stringify(j).includes("4411"), false, "gate code stays private");
  assert.equal(j.customer.name, "Jordan R.");
  assert.equal(j.pay.earningsCents, 4700);
  assert.equal(j.vehicle.vin, undefined);
  assert.equal(j.pay.platformCents, undefined);

  const brakes = await book({ serviceIds: ["spark_plugs"] });
  assert.ok(!(await ok("GET", "/v1/jobs/board", pa)).jobs.some((x) => x.id === brakes.id), "partners only see jobs for services they offer");
  await ok("POST", `/v1/jobs/${brakes.id}/cancel`, cust, {});
  await ok("POST", `/v1/jobs/${job.id}/cancel`, cust, {});
});

test("first partner to accept gets it; the customer sees who", async () => {
  const job = await book();
  const r = await ok("POST", `/v1/jobs/${job.id}/accept`, pa);
  assert.equal(r.job.status, "confirmed");
  const late = await call("POST", `/v1/jobs/${job.id}/accept`, pb);
  assert.equal(late.status, 409);
  assert.match(late.body.error.message, /already took/);
  const c = (await ok("GET", `/v1/jobs/${job.id}`, cust)).job;
  assert.deepEqual(c.partner, { id: paId, name: "Amanda S.", jobsDone: 0, rating: { average: null, count: 0 } });
  assert.equal((await call("GET", `/v1/jobs/${job.id}`, pb)).status, 404, "other partners can't see a taken job");
  assert.equal((await call("GET", `/v1/jobs/${job.id}`, cust2)).status, 404, "other customers can't see it");
  assert.equal((await call("POST", `/v1/jobs/${job.id}/accept`, pc)).status, 403, "applicants can't accept");
  await ok("POST", `/v1/jobs/${job.id}/cancel`, cust, {});
});

test("customer approval: 5 minutes same day; no answer sends it to the next partner", async () => {
  const job = await book({ approvePartner: true, windowStart: clock + 5 * HOUR });
  const a = await ok("POST", `/v1/jobs/${job.id}/accept`, pa);
  assert.equal(a.job.status, "awaiting_approval");
  assert.equal(a.job.approvalDeadline, clock + 5 * MIN);
  tick(6 * MIN);
  const c = (await ok("GET", `/v1/jobs/${job.id}`, cust)).job;
  assert.equal(c.status, "requested");
  assert.ok(c.timeline.some((e) => e.kind === "approval_timed_out"));
  assert.ok(!(await ok("GET", "/v1/jobs/board", pa)).jobs.some((x) => x.id === job.id), "the partner who timed out doesn't get it again");
  await ok("POST", `/v1/jobs/${job.id}/accept`, pb);
  const d = await ok("POST", `/v1/jobs/${job.id}/decline-partner`, cust);
  assert.equal(d.job.status, "requested");
  assert.ok(!(await ok("GET", "/v1/jobs/board", pb)).jobs.some((x) => x.id === job.id));
  await ok("POST", `/v1/jobs/${job.id}/cancel`, cust, {});

  const later = await book({ approvePartner: true, windowStart: clock + 3 * DAY });
  const l = await ok("POST", `/v1/jobs/${later.id}/accept`, pa);
  assert.equal(l.job.approvalDeadline, clock + 120 * MIN, "2 hours to answer for scheduled visits");
  const ap = await ok("POST", `/v1/jobs/${later.id}/approve-partner`, cust);
  assert.equal(ap.job.status, "confirmed");
  await ok("POST", `/v1/jobs/${later.id}/cancel`, cust, {});
});

test("full visit: trip, address unlocks, check-in, add-ons, inspection, completion, partner pay, warranty", async () => {
  const job = await book({ serviceIds: ["oil_change", "tire_rotation"], windowStart: clock + 4 * HOUR });
  await ok("POST", `/v1/jobs/${job.id}/accept`, pa);
  let r = await call("POST", `/v1/jobs/${job.id}/start-trip`, pa);
  assert.equal(r.status, 409);
  assert.match(r.body.error.message, /3 hours before/);
  tick(HOUR + MIN);
  let p = (await ok("POST", `/v1/jobs/${job.id}/start-trip`, pa)).job;
  assert.equal(p.status, "en_route");
  assert.equal(p.place.street, "123 Kingston Pike", "address unlocks on Start Trip");
  assert.equal(p.place.notes, "Gate code 4411");
  assert.equal((await ok("GET", `/v1/jobs/${job.id}`, cust)).job.cancelPreview.feeCents, 5000, "cancelling now costs the on-the-way fee");

  assert.equal((await call("POST", `/v1/jobs/${job.id}/check-in`, pa, { odometer: 84500 })).status, 409, "arrive first");
  await ok("POST", `/v1/jobs/${job.id}/arrive`, pa);
  r = await call("POST", `/v1/jobs/${job.id}/check-in`, pa, { odometer: "lots" });
  assert.match(r.body.error.fields.odometer, /whole number/);
  p = (await ok("POST", `/v1/jobs/${job.id}/check-in`, pa, { odometer: "84,500" })).job;
  assert.equal(p.status, "in_progress");
  assert.equal((await ok("GET", `/v1/vehicles/${vehicleId}`, cust)).vehicle.mileage, 84500, "vehicle mileage updated");

  r = await call("POST", `/v1/jobs/${job.id}/addons`, pa, { serviceIds: ["oil_change"], reason: "Again" });
  assert.match(r.body.error.fields.serviceIds, /already on this job/);
  r = await call("POST", `/v1/jobs/${job.id}/addons`, pa, { serviceIds: ["brakes"], reason: "" });
  assert.match(r.body.error.fields.reason, /what you found/);
  p = (await ok("POST", `/v1/jobs/${job.id}/addons`, pa, { serviceIds: ["brakes"], reason: "Front pads at 2 mm, rotors scored" })).job;
  await ok("POST", `/v1/jobs/${job.id}/addons`, pa, { serviceIds: ["air_filters"], reason: "Engine air filter is black" });
  let c = (await ok("GET", `/v1/jobs/${job.id}`, cust)).job;
  const brakesAddon = c.addons.find((a) => a.serviceId === "brakes");
  assert.equal(brakesAddon.status, "pending");
  assert.equal(brakesAddon.line.priceCents, 35300);
  await ok("POST", `/v1/jobs/${job.id}/addons/${brakesAddon.id}/approve`, cust);
  assert.equal((await call("POST", `/v1/jobs/${job.id}/addons/${brakesAddon.id}/decline`, cust)).status, 409, "can't answer twice");

  r = await call("POST", `/v1/jobs/${job.id}/complete`, pa, { inspection: { brakes: { status: "now" } } });
  assert.match(r.body.error.fields.inspection, /Brakes \(add a note\).*Tires/);
  p = (await ok("POST", `/v1/jobs/${job.id}/complete`, pa, { inspection: { ...INSPECTION, wipers: { status: "soon", note: "Streaking" } }, notes: "Used 0W-20 full synthetic" })).job;
  assert.equal(p.status, "completed");
  assert.equal(p.place, null, "address hidden again after the job");
  assert.equal(p.final.partnerPay.earningsCents, (4000 + 4000 + 15000) * 0.8 + 1500);
  c = (await ok("GET", `/v1/jobs/${job.id}`, cust)).job;
  assert.equal(c.final.totalCents, 8000 + 4000 + 35300 + 1800, "approved add-on included, unanswered one left out");
  assert.equal(c.final.partnerPay, undefined);
  assert.equal(c.addons.find((a) => a.serviceId === "air_filters").status, "expired");
  assert.equal(c.inspection.wipers.status, "soon");
  assert.equal(c.warrantyMilesUntil, 84500 + 12000);
  assert.ok(c.warrantyUntil > clock + 364 * DAY);
  assert.deepEqual(c.timeline.map((e) => e.kind), ["booked", "accepted", "confirmed", "trip_started", "arrived", "checked_in", "addons_requested", "addons_requested", "addon_approved", "completed"]);
  assert.equal((await ok("GET", `/v1/jobs/${job.id}`, cust)).job.partner.jobsDone, 1);
});

test("customer cancel fees: free early, $25 inside 48 hours, $50 once the partner is on the way", async () => {
  let job = await book({ windowStart: clock + 3 * DAY });
  await ok("POST", `/v1/jobs/${job.id}/accept`, pa);
  let c = (await ok("GET", `/v1/jobs/${job.id}`, cust)).job;
  assert.equal(c.cancelPreview.feeCents, 0);
  tick(DAY + HOUR);
  c = (await ok("GET", `/v1/jobs/${job.id}`, cust)).job;
  assert.equal(c.cancelPreview.feeCents, 2500);
  assert.match(c.cancelPreview.reason, /48 hours/);
  const stale = await call("POST", `/v1/jobs/${job.id}/cancel`, cust, { expectedFeeCents: 0 });
  assert.equal(stale.status, 409, "fee changed since the customer looked");
  c = (await ok("POST", `/v1/jobs/${job.id}/cancel`, cust, { expectedFeeCents: 2500, reason: "Plans changed" })).job;
  assert.deepEqual([c.status, c.cancelFeeCents], ["cancelled", 2500]);
  const p = (await ok("GET", `/v1/jobs`, pa)).jobs.find((x) => x.id === job.id);
  assert.equal(p.partnerCompCents, 2000, "the partner keeps their share");

  job = await book({ windowStart: clock + 4 * HOUR });
  await ok("POST", `/v1/jobs/${job.id}/accept`, pa);
  tick(2 * HOUR);
  await ok("POST", `/v1/jobs/${job.id}/start-trip`, pa);
  c = (await ok("POST", `/v1/jobs/${job.id}/cancel`, cust, {})).job;
  assert.equal(c.cancelFeeCents, 5000);
  assert.equal((await call("POST", `/v1/jobs/${job.id}/cancel`, cust, {})).status, 409);
});

test("no-show: only after 15 minutes at the job; $50 fee, partner keeps $40", async () => {
  const job = await book({ windowStart: clock + 3 * HOUR });
  await ok("POST", `/v1/jobs/${job.id}/accept`, pa);
  await ok("POST", `/v1/jobs/${job.id}/start-trip`, pa);
  await ok("POST", `/v1/jobs/${job.id}/arrive`, pa);
  tick(10 * MIN);
  const r = await call("POST", `/v1/jobs/${job.id}/no-show`, pa);
  assert.equal(r.status, 409);
  assert.match(r.body.error.message, /wait 15 minutes/);
  tick(6 * MIN);
  const p = (await ok("POST", `/v1/jobs/${job.id}/no-show`, pa)).job;
  assert.deepEqual([p.status, p.cancelReason, p.partnerCompCents], ["cancelled", "no_show", 4000]);
});

test("partner cancels: free more than 24 hours out; late cancels give the customer $15 and 3 in 30 days flag a review", async () => {
  const early = await book({ windowStart: clock + 3 * DAY });
  await ok("POST", `/v1/jobs/${early.id}/accept`, pb);
  let r = await ok("POST", `/v1/jobs/${early.id}/cancel`, pb, {});
  assert.equal(r.late, false);
  let c = (await ok("GET", `/v1/jobs/${early.id}`, cust)).job;
  assert.equal(c.status, "requested");
  assert.equal(c.partner, null);
  assert.ok(!(await ok("GET", "/v1/jobs/board", pb)).jobs.some((x) => x.id === early.id), "goes to someone else");
  assert.equal((await ok("GET", "/v1/jobs/board", pa)).jobs[0].id, early.id, "first in line");
  await ok("POST", `/v1/jobs/${early.id}/cancel`, cust, {});

  for (let i = 1; i <= 3; i++) {
    const j = await book({ windowStart: clock + 5 * HOUR });
    await ok("POST", `/v1/jobs/${j.id}/accept`, pb);
    r = await ok("POST", `/v1/jobs/${j.id}/cancel`, pb, { reason: "Truck broke down" });
    assert.equal(r.late, true);
    assert.equal(r.lateCancelsCount, i);
    await ok("POST", `/v1/jobs/${j.id}/cancel`, cust, {});
  }
  const partners = await ok("GET", "/v1/admin/partners", admin);
  assert.equal(partners.partners.find((x) => x.email === "pb@example.com").reviewReason, "3 late cancels in 30 days");

  // The $45 in credits comes off the next completed job.
  const j = await book({ windowStart: clock + 3 * HOUR });
  await ok("POST", `/v1/jobs/${j.id}/accept`, pa);
  await ok("POST", `/v1/jobs/${j.id}/start-trip`, pa);
  await ok("POST", `/v1/jobs/${j.id}/arrive`, pa);
  await ok("POST", `/v1/jobs/${j.id}/check-in`, pa, { odometer: 85000 });
  await ok("POST", `/v1/jobs/${j.id}/complete`, pa, { inspection: INSPECTION });
  c = (await ok("GET", `/v1/jobs/${j.id}`, cust)).job;
  assert.deepEqual([c.final.totalCents, c.final.creditsCents, c.final.chargeCents], [9800, 4500, 5300]);
});

test("reschedule: 2 free, then $25; partner late to leave: switch partner, or reschedule free with $10 credit", async () => {
  const job = await book({ windowStart: clock + 3 * DAY });
  for (let i = 0; i < 2; i++) {
    const c = (await ok("POST", `/v1/jobs/${job.id}/reschedule`, cust, { windowStart: clock + (4 + i) * DAY })).job;
    assert.equal(c.freeReschedulesLeft, 1 - i);
  }
  let r = await call("POST", `/v1/jobs/${job.id}/reschedule`, cust, { windowStart: clock + 6 * DAY, expectedFeeCents: 0 });
  assert.equal(r.status, 409, "third reschedule costs $25");
  r = await ok("POST", `/v1/jobs/${job.id}/reschedule`, cust, { windowStart: clock + 6 * DAY, expectedFeeCents: 2500 });
  assert.equal(r.job.windowStart, clock + 6 * DAY);
  await ok("POST", `/v1/jobs/${job.id}/cancel`, cust, {});

  const j2 = await book({ windowStart: clock + 3 * HOUR });
  await ok("POST", `/v1/jobs/${j2.id}/accept`, pa);
  assert.equal((await call("POST", `/v1/jobs/${j2.id}/switch-partner`, cust)).status, 409, "only when the partner is late");
  tick(2 * HOUR + 31 * MIN);
  let c = (await ok("GET", `/v1/jobs/${j2.id}`, cust)).job;
  assert.equal(c.partnerLate, true);
  c = (await ok("POST", `/v1/jobs/${j2.id}/switch-partner`, cust)).job;
  assert.deepEqual([c.status, c.partner], ["requested", null]);
  await ok("POST", `/v1/jobs/${j2.id}/cancel`, cust, {});

  const j3 = await book({ windowStart: clock + 3 * HOUR });
  await ok("POST", `/v1/jobs/${j3.id}/accept`, pa);
  tick(2 * HOUR + 31 * MIN);
  c = (await ok("POST", `/v1/jobs/${j3.id}/reschedule`, cust, { windowStart: clock + DAY, expectedFeeCents: 0 })).job;
  assert.equal(c.rescheduleCount, 0, "doesn't use up a free reschedule");
  assert.equal(c.timeline.at(-1).creditCents, 1000);
  await ok("POST", `/v1/jobs/${j3.id}/cancel`, cust, {});
  await app.db.run(`UPDATE customer_credits SET used_at = 1 WHERE used_at IS NULL`);
});

test("requests nobody takes expire: 4 hours for as-soon-as-possible, 1 hour for roadside", async () => {
  const asap = await book({ kind: "asap", windowStart: undefined });
  const road = await book({ kind: "roadside", serviceIds: ["jump_start"], windowStart: undefined });
  assert.equal(road.windowEnd - road.windowStart, HOUR);
  tick(HOUR + MIN);
  assert.equal((await ok("GET", `/v1/jobs/${road.id}`, cust)).job.status, "expired");
  assert.equal((await ok("GET", `/v1/jobs/${asap.id}`, cust)).job.status, "requested");
  tick(3 * HOUR);
  assert.equal((await ok("GET", `/v1/jobs/${asap.id}`, cust)).job.status, "expired");
  assert.equal((await call("POST", `/v1/jobs/${asap.id}/accept`, pa)).status, 409);
});

test("glass: partner quotes from the supplier cost; declining is free; a glass-only job then ends with no charge", async () => {
  const job = await book({ serviceIds: ["glass_windshield", "oil_change"], windowStart: clock + 3 * HOUR });
  assert.equal(job.quote.pending[0].serviceId, "glass_windshield");
  await ok("POST", `/v1/jobs/${job.id}/accept`, pa);
  let r = await call("POST", `/v1/jobs/${job.id}/glass-quote`, pa, { serviceId: "glass_windshield", glassCost: 289.5, partNumber: "FW04512", supplier: "Pilkington", needsCalibration: true });
  assert.match(r.body.error.fields.note, /above the typical price/);
  await ok("POST", `/v1/jobs/${job.id}/glass-quote`, pa, { serviceId: "glass_windshield", glassCost: 289.5, partNumber: "FW04512", supplier: "Pilkington", needsCalibration: true, note: "Heated wiper park + camera bracket" });
  let c = (await ok("GET", `/v1/jobs/${job.id}`, cust)).job;
  const g = c.addons.find((a) => a.kind === "glass");
  assert.equal(g.line.priceCents, 76093);
  assert.equal(g.line.glassCostCents, undefined, "customers don't see the glass cost");
  assert.equal(g.line.partNumber, "FW04512");
  c = (await ok("POST", `/v1/jobs/${job.id}/addons/${g.id}/decline`, cust)).job;
  assert.equal(c.status, "confirmed", "the oil change still happens");
  await ok("POST", `/v1/jobs/${job.id}/cancel`, cust, {});

  const only = await book({ serviceIds: ["glass_windshield"], windowStart: clock + 3 * HOUR });
  await ok("POST", `/v1/jobs/${only.id}/accept`, pa);
  await ok("POST", `/v1/jobs/${only.id}/glass-quote`, pa, { serviceId: "glass_windshield", glassCost: 210, partNumber: "FW1", supplier: "Safelite" });
  const g2 = (await ok("GET", `/v1/jobs/${only.id}`, cust)).job.addons[0];
  c = (await ok("POST", `/v1/jobs/${only.id}/addons/${g2.id}/decline`, cust)).job;
  assert.deepEqual([c.status, c.cancelFeeCents, c.cancelReason], ["cancelled", 0, "glass_quote_declined"]);
});

test("a booking keeps its prices when settings change later", async () => {
  const job = await book({ windowStart: clock + 3 * HOUR });
  await ok("POST", "/v1/pricing/settings", admin, { changes: { labor: 120 }, note: "Test rate change" }, 201);
  await ok("POST", `/v1/jobs/${job.id}/accept`, pa);
  await ok("POST", `/v1/jobs/${job.id}/start-trip`, pa);
  await ok("POST", `/v1/jobs/${job.id}/arrive`, pa);
  await ok("POST", `/v1/jobs/${job.id}/check-in`, pa, { odometer: 86000 });
  await ok("POST", `/v1/jobs/${job.id}/addons`, pa, { serviceIds: ["tire_rotation"], reason: "Uneven wear on fronts" });
  const c = (await ok("GET", `/v1/jobs/${job.id}`, cust)).job;
  assert.equal(c.addons[0].line.laborCents, 4000, "add-ons use the booking's version too");
  await ok("POST", `/v1/jobs/${job.id}/addons/${c.addons[0].id}/approve`, cust);
  const done = (await ok("POST", `/v1/jobs/${job.id}/complete`, pa, { inspection: INSPECTION })).job;
  assert.equal(done.final.partnerPay.laborCents, 8000);
  const next = await book({ windowStart: clock + 3 * HOUR });
  assert.equal(next.settingsVersion, 2);
  assert.equal(next.quote.lines[0].laborCents, 4800);
  await ok("POST", `/v1/jobs/${next.id}/cancel`, cust, {});
});

test("staff set partner status; pausing needs a reason; only staff can", async () => {
  const list = await ok("GET", "/v1/admin/partners", admin);
  const id = list.partners.find((p) => p.email === "pc@example.com").id;
  assert.equal((await call("POST", `/v1/admin/partners/${id}/status`, pa, { status: "active" })).status, 403);
  const r = await call("POST", `/v1/admin/partners/${id}/status`, admin, { status: "paused" });
  assert.match(r.body.error.fields.reason, /Say why/);
  await ok("POST", `/v1/admin/partners/${id}/status`, admin, { status: "paused", reason: "Insurance expired" });
  assert.match((await ok("GET", "/v1/jobs/board", pc)).blocked, /paused/);
  assert.equal((await call("GET", "/v1/admin/partners", cust)).status, 403);
});

test("brake, glass, DOT, and wash jobs only go to partners whose proof is approved, even after approval", async () => {
  const d = await call("POST", "/v1/auth/signup", null, partner({ email: "pd@example.com", firstName: "Dana", lastName: "Ruiz" }));
  const pd = d.body.token;
  await ok("POST", `/v1/admin/partners/${d.body.user.id}/status`, admin, { status: "active" });
  const saved = await ok("PUT", "/v1/partner/services", pd, { serviceIds: ["oil_change", "brakes", "glass_windshield"] });
  assert.deepEqual(saved.waitingForProof.map((x) => x.serviceId).sort(), ["brakes", "glass_windshield"]);
  assert.deepEqual(saved.waitingForProof.find((x) => x.serviceId === "brakes").needs, ["ASE certificate or brake-work proof"]);

  const job = await book({ serviceIds: ["brakes"] });
  const oil = await book({ serviceIds: ["oil_change"] });
  const board = (await ok("GET", "/v1/jobs/board", pd)).jobs.map((j) => j.id);
  assert.ok(board.includes(oil.id), "jobs without proof requirements still show");
  assert.ok(!board.includes(job.id), "brake jobs wait for approved proof");
  const r = await call("POST", `/v1/jobs/${job.id}/accept`, pd);
  assert.equal(r.status, 409);
  assert.match(r.body.error.message, /once your proof is approved/);

  // A pending upload doesn't count; an approved one does.
  await app.db.run(`INSERT INTO partner_documents (id, user_id, kind, filename, content_type, size_bytes, data, status, created_at) VALUES ('pd-ase', $1, 'ase', 'ase.pdf', 'application/pdf', 4, 'JVBERg==', 'pending', $2)`, [d.body.user.id, clock]);
  assert.ok(!(await ok("GET", "/v1/jobs/board", pd)).jobs.some((j) => j.id === job.id));
  await app.db.run(`UPDATE partner_documents SET status = 'approved' WHERE id = 'pd-ase'`);
  assert.ok((await ok("GET", "/v1/jobs/board", pd)).jobs.some((j) => j.id === job.id));
  assert.deepEqual((await ok("GET", "/v1/partner/services", pd)).waitingForProof.map((x) => x.serviceId), ["glass_windshield"]);
  await ok("POST", `/v1/jobs/${job.id}/accept`, pd);
  await ok("POST", `/v1/jobs/${job.id}/cancel`, cust, {});
  await ok("POST", `/v1/jobs/${oil.id}/cancel`, cust, {});
});
