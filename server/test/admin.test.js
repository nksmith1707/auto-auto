import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startTestApp, customer, partner } from "./helpers.js";

const HOUR = 3_600_000;
let clock = Date.parse("2026-11-02T13:00:00Z");
let app, cust, pa, paId, admin, vehicleId, placeId;

const call = (m, p, token, body) => app.call(m, p, { token, body });
const ok = async (m, p, token, body, status = 200) => {
  const r = await call(m, p, token, body);
  assert.equal(r.status, status, `${m} ${p} → ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
};
const INSPECTION = Object.fromEntries(["brakes", "tires", "fluids", "battery", "wipers", "lights", "belts_hoses", "filters"].map((k) => [k, { status: "good" }]));

before(async () => {
  app = await startTestApp({}, { now: () => clock });
  cust = (await call("POST", "/v1/auth/signup", null, customer({ email: "adm-c@example.com" }))).body.token;
  const a = await call("POST", "/v1/auth/signup", null, partner({ email: "adm-p@example.com" }));
  pa = a.body.token; paId = a.body.user.id;
  const ad = await call("POST", "/v1/auth/signup", null, customer({ email: "adm-ops@example.com" }));
  await app.db.run(`UPDATE users SET role = 'admin' WHERE id = $1`, [ad.body.user.id]);
  admin = ad.body.token;
  await ok("POST", `/v1/admin/partners/${paId}/status`, admin, { status: "active" });
  await ok("PUT", "/v1/partner/services", pa, { serviceIds: ["oil_change"] });
  vehicleId = (await ok("POST", "/v1/vehicles", cust, { year: 2015, make: "Honda", model: "Civic" }, 201)).vehicle.id;
  placeId = (await ok("POST", "/v1/places", cust, { label: "Home", street: "123 Kingston Pike", city: "Knoxville", state: "TN", zip: "37919", notes: "Gate 4411" }, 201)).place.id;
});
after(async () => { await app.close(); });

test("only staff can use the console endpoints", async () => {
  for (const path of ["/v1/admin/overview", "/v1/admin/jobs", "/v1/admin/insurance", "/v1/admin/payouts"]) {
    assert.equal((await call("GET", path, cust)).status, 403, path);
    assert.equal((await call("GET", path, null)).status, 401, path);
  }
});

test("the console page is served with a strict content policy", async () => {
  const res = await fetch(`${app.base}/ops`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /text\/html/);
  assert.match(res.headers.get("content-security-policy"), /default-src 'self'/);
  assert.match(await res.text(), /Ops Console/);
  assert.equal((await fetch(`${app.base}/ops/app.js`)).status, 200);
  assert.equal((await fetch(`${app.base}/ops/console.css`)).status, 200);
  assert.equal((await fetch(`${app.base}/ops/..%2Fpackage.json`)).status, 404);
  assert.equal((await fetch(`${app.base}/ops/nope.html`)).status, 404);
});

test("overview, job lists, and a job's full record", async () => {
  const late = (await ok("POST", "/v1/jobs", cust, { vehicleId, placeId, serviceIds: ["oil_change"], kind: "scheduled", windowStart: clock + 3 * HOUR }, 201)).job;
  await ok("POST", `/v1/jobs/${late.id}/accept`, pa);
  const done = (await ok("POST", "/v1/jobs", cust, { vehicleId, placeId, serviceIds: ["oil_change"], kind: "asap" }, 201)).job;
  await ok("POST", `/v1/jobs/${done.id}/accept`, pa);
  for (const a of ["start-trip", "arrive"]) await ok("POST", `/v1/jobs/${done.id}/${a}`, pa);
  await ok("POST", `/v1/jobs/${done.id}/check-in`, pa, { odometer: 85000 });
  await ok("POST", `/v1/jobs/${done.id}/complete`, pa, { inspection: INSPECTION });
  await ok("POST", "/v1/jobs", cust, { vehicleId, placeId, serviceIds: ["oil_change"], kind: "scheduled", windowStart: clock + 48 * HOUR }, 201);

  clock = late.windowStart - 20 * 60_000; // partner hasn't left 30 minutes before the window
  const o = await ok("GET", "/v1/admin/overview", admin);
  assert.equal(o.jobsLate, 1);
  assert.equal(o.jobsWaiting, 1);
  assert.equal(o.today.completed, 1);
  assert.ok(o.today.chargedCents > 0);
  assert.equal(o.partnersActive, 1);

  const lateList = (await ok("GET", "/v1/admin/jobs?filter=late", admin)).jobs;
  assert.deepEqual(lateList.map((j) => j.id), [late.id]);
  assert.equal(lateList[0].late, true);
  assert.equal(lateList[0].customer, "Jordan Reed");
  assert.equal((await ok("GET", "/v1/admin/jobs?filter=completed", admin)).jobs[0].id, done.id);
  assert.equal((await ok("GET", "/v1/admin/jobs?filter=all&q=amanda", admin)).jobs.length, 2, "search by partner name");
  assert.equal((await call("GET", "/v1/admin/jobs?filter=bogus", admin)).status, 422);

  const j = (await ok("GET", `/v1/admin/jobs/${done.id}`, admin)).job;
  assert.equal(j.customer.email, "adm-c@example.com");
  assert.ok(j.partnerContact.phone, "staff see contact details");
  assert.equal(j.place.notes, "Gate 4411", "staff see the full address and notes");
  assert.ok(j.partnerPay.earningsCents > 0);
  assert.ok(j.timeline.some((e) => e.kind === "completed"));
  assert.ok(j.allPhotos);
});

test("insurance list shows each partner policy with days left; payouts list balances", async () => {
  await app.db.run(`INSERT INTO partner_applications (user_id, answers, created_at, updated_at) VALUES ($1, $2, $3, $3)`,
    [paId, JSON.stringify({ insurance: { coverage: "split", autoExpires: "2026-11-20", autoCarrier: "State Farm", glExpires: "2026-10-01" } }), clock]);
  const pol = (await ok("GET", "/v1/admin/insurance", admin)).policies;
  assert.deepEqual(pol.map((x) => [x.policy, x.document]), [["gl", "missing"], ["auto", "missing"]], "expired first");
  assert.ok(pol[0].daysLeft < 0);
  assert.ok(pol[1].daysLeft > 0 && pol[1].daysLeft < 30);
  const o = await ok("GET", "/v1/admin/overview", admin);
  assert.equal(o.insuranceExpired, 1);
  assert.equal(o.insuranceExpiring, 1);
  const p = await ok("GET", "/v1/admin/payouts", admin);
  assert.equal(p.enabled, false);
  assert.deepEqual(p.partners, [], "no payout accounts yet");
  const partners = (await ok("GET", "/v1/admin/partners", admin)).partners;
  assert.equal(partners.find((x) => x.id === paId).jobsDone, 1);
});
