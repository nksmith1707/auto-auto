import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startTestApp, customer, partner } from "./helpers.js";

const HOUR = 3_600_000, DAY = 24 * HOUR;
let clock = Date.parse("2026-11-02T13:00:00Z");
let app, cust, cust2, pa, pb, admin, vehicleId, placeId;

const call = (m, p, token, body) => app.call(m, p, { token, body });
const ok = async (m, p, token, body, status = 200) => {
  const r = await call(m, p, token, body);
  assert.equal(r.status, status, `${m} ${p} → ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
};
// The smallest valid JPEG and PNG headers are enough for the type check.
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]).toString("base64");
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(100, 1)]).toString("base64");
const shot = (token, id, slot, extra = {}) => call("POST", `/v1/jobs/${id}/photos`, token, { slot, contentType: "image/jpeg", data: JPG, ...extra });
const INSPECTION = Object.fromEntries(["brakes", "tires", "fluids", "battery", "wipers", "lights", "belts_hoses", "filters"].map((k) => [k, { status: "good" }]));
const CHECKIN = ["e0", "e1", "e2", "e3", "e4", "e5", "e6", "e7", "i0", "i1", "i2", "i3"];

async function arrivedJob() {
  const job = (await ok("POST", "/v1/jobs", cust, { vehicleId, placeId, serviceIds: ["oil_change"], kind: "scheduled", windowStart: clock + 3 * HOUR }, 201)).job;
  await ok("POST", `/v1/jobs/${job.id}/accept`, pa);
  await ok("POST", `/v1/jobs/${job.id}/start-trip`, pa);
  await ok("POST", `/v1/jobs/${job.id}/arrive`, pa);
  return job;
}

before(async () => {
  app = await startTestApp({ REQUIRE_JOB_PHOTOS: "on", PHOTO_URL_SECRET: "test-secret" }, { now: () => clock });
  cust = (await call("POST", "/v1/auth/signup", null, customer({ email: "ph-c@example.com" }))).body.token;
  cust2 = (await call("POST", "/v1/auth/signup", null, customer({ email: "ph-c2@example.com" }))).body.token;
  const a = await call("POST", "/v1/auth/signup", null, partner({ email: "ph-a@example.com" }));
  pa = a.body.token;
  const b = await call("POST", "/v1/auth/signup", null, partner({ email: "ph-b@example.com" }));
  pb = b.body.token;
  const ad = await call("POST", "/v1/auth/signup", null, customer({ email: "ph-ops@example.com" }));
  await app.db.run(`UPDATE users SET role = 'admin' WHERE id = $1`, [ad.body.user.id]);
  admin = ad.body.token;
  for (const id of [a.body.user.id, b.body.user.id]) await ok("POST", `/v1/admin/partners/${id}/status`, admin, { status: "active" });
  await ok("PUT", "/v1/partner/services", pa, { serviceIds: ["oil_change"] });
  vehicleId = (await ok("POST", "/v1/vehicles", cust, { year: 2015, make: "Honda", model: "Civic", mileage: 84000 }, 201)).vehicle.id;
  placeId = (await ok("POST", "/v1/places", cust, { label: "Home", street: "123 Kingston Pike", city: "Knoxville", state: "TN", zip: "37919" }, 201)).place.id;
});
after(async () => { await app.close(); });

test("check-in: 12 photos and the odometer before work starts; damage notes are kept", async () => {
  const job = (await ok("POST", "/v1/jobs", cust, { vehicleId, placeId, serviceIds: ["oil_change"], kind: "scheduled", windowStart: clock + 3 * HOUR }, 201)).job;
  await ok("POST", `/v1/jobs/${job.id}/accept`, pa);
  let r = await shot(pa, job.id, "e0");
  assert.equal(r.status, 409, "not before arriving");
  await ok("POST", `/v1/jobs/${job.id}/start-trip`, pa);
  await ok("POST", `/v1/jobs/${job.id}/arrive`, pa);
  assert.equal((await shot(pb, job.id, "e0")).status, 404, "only the job's partner");
  assert.equal((await shot(pa, job.id, "x9")).status, 422);
  assert.equal((await shot(pa, job.id, "e0", { contentType: "application/pdf" })).status, 422);
  assert.equal((await shot(pa, job.id, "e0", { data: Buffer.from("not a photo").toString("base64") })).status, 422);

  r = await call("POST", `/v1/jobs/${job.id}/check-in`, pa, { odometer: 85000 });
  assert.equal(r.status, 409);
  assert.match(r.body.error.message, /12 check-in photos.*Front, Front right/);

  for (const s of CHECKIN.slice(0, 11)) await shot(pa, job.id, s);
  r = await shot(pa, job.id, "e4", { contentType: "image/png", data: PNG }); // a retake
  assert.equal(r.body.photos.checkin.length, 11);
  assert.deepEqual(r.body.photos.checkinNeeded, [{ slot: "i3", label: "Cargo area" }]);
  await shot(pa, job.id, "i3");
  const d = await ok("POST", `/v1/jobs/${job.id}/photos/e4/damage`, pa, { note: "Scuff on rear bumper, driver side" });
  assert.deepEqual(d.photos.damage, [{ slot: "e4", label: "Rear", note: "Scuff on rear bumper, driver side" }]);

  const seen = (await ok("GET", `/v1/jobs/${job.id}`, pa)).job;
  assert.equal(seen.photos.checkin.length, 12);
  assert.equal(seen.photosRequired, true);
  await ok("POST", `/v1/jobs/${job.id}/check-in`, pa, { odometer: 85000 });
  assert.equal((await shot(pa, job.id, "e0")).status, 409, "check-in photos lock once work starts");

  // The customer sees check-in photos and the damage note once work starts.
  const c = (await ok("GET", `/v1/jobs/${job.id}`, cust)).job;
  assert.equal(c.photos.checkin.length, 12);
  assert.equal(c.photos.damage[0].note, "Scuff on rear bumper, driver side");
  assert.deepEqual(c.photos.after, []);

  // Complete needs both after photos.
  r = await call("POST", `/v1/jobs/${job.id}/complete`, pa, { inspection: INSPECTION });
  assert.equal(r.status, 409);
  assert.match(r.body.error.message, /after photos.*After 1, After 2/);
  await shot(pa, job.id, "a0");
  await shot(pa, job.id, "a1");
  await ok("POST", `/v1/jobs/${job.id}/complete`, pa, { inspection: INSPECTION, notes: "Changed oil and filter. Topped off washer fluid." });
  const done = (await ok("GET", `/v1/jobs/${job.id}`, cust)).job;
  assert.equal(done.photos.after.length, 2);
});

test("photo links are signed and expire; the photo itself comes back as stored", async () => {
  const job = (await ok("GET", "/v1/jobs", cust)).jobs.find((j) => j.status === "completed");
  const p = job.photos.checkin.find((x) => x.slot === "e4");
  const res = await fetch(app.base + p.url);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "image/png", "the retake replaced the first photo");
  assert.equal(Buffer.from(await res.arrayBuffer()).toString("base64"), PNG);
  assert.equal((await fetch(app.base + p.url.replace(/sig=[^&]+/, "sig=forged"))).status, 403);
  assert.equal((await fetch(app.base + p.url.replace(/exp=\d+/, `exp=${clock + 99 * HOUR}`))).status, 403, "can't extend the time");
  clock += 7 * HOUR;
  assert.equal((await fetch(app.base + p.url)).status, 403, "expired after 6 hours");
  const fresh = (await ok("GET", `/v1/jobs/${job.id}`, cust)).job.photos.checkin[0].url;
  assert.equal((await fetch(app.base + fresh)).status, 200, "opening the job again gives new links");
});

test("service history: every finished visit with mileage, inspection, notes, and photos; owner only", async () => {
  const h = await ok("GET", `/v1/vehicles/${vehicleId}/history`, cust);
  assert.equal(h.vehicle.model, "Civic");
  assert.equal(h.visits.length, 1);
  const v = h.visits[0];
  assert.equal(v.odometer, 85000);
  assert.deepEqual(v.services, ["Oil change"]);
  assert.match(v.notes, /Changed oil/);
  assert.equal(v.inspection.brakes.status, "good");
  assert.equal(v.photos.checkin.length, 12);
  assert.equal(v.photos.after.length, 2);
  assert.equal(v.photos.damage.length, 1);
  assert.ok(v.warrantyUntil);
  assert.equal((await call("GET", `/v1/vehicles/${vehicleId}/history`, cust2)).status, 404);
  assert.equal((await call("GET", `/v1/vehicles/${vehicleId}/history`, pa)).status, 403);
});

test("incident reports: damage needs a photo; staff see and close them", async () => {
  const job = await arrivedJob();
  const list = await ok("GET", "/v1/incidents", pa);
  assert.ok(list.jobs.some((j) => j.id === job.id), "active jobs can be reported on");
  let r = await call("POST", "/v1/incidents", pa, { type: "vehicle_damage", jobId: job.id, description: "Scratched the fender with a creeper while pulling out." });
  assert.equal(r.status, 422);
  assert.match(r.body.error.fields.photos, /at least one photo/);
  assert.equal((await call("POST", "/v1/incidents", pa, { type: "vehicle_damage", description: "short", photos: [{ contentType: "image/jpeg", data: JPG }] })).status, 422);
  assert.equal((await call("POST", "/v1/incidents", pb, { type: "unsafe", jobId: job.id, description: "Not my job but reporting anyway here." })).status, 422, "only your own jobs");
  const inc = await ok("POST", "/v1/incidents", pa, { type: "vehicle_damage", jobId: job.id, description: "Scratched the fender with a creeper while pulling out.", photos: [{ contentType: "image/jpeg", data: JPG }, { contentType: "image/png", data: PNG }] }, 201);
  assert.equal(inc.incident.photos.length, 2);
  assert.equal(inc.incident.typeLabel, "Damage to customer vehicle");
  assert.equal((await fetch(app.base + inc.incident.photos[1].url)).headers.get("content-type"), "image/png");
  await ok("POST", "/v1/incidents", pa, { type: "customer_behavior", description: "Customer asked me to work on a second car off the app." }, 201);
  assert.equal((await ok("GET", "/v1/incidents", pa)).incidents.length, 2);
  assert.equal((await ok("GET", "/v1/incidents", pb)).incidents.length, 0);
  const tl = (await ok("GET", `/v1/jobs/${job.id}`, cust)).job.timeline.map((e) => e.kind);
  assert.ok(tl.includes("incident_reported"));

  const open = await ok("GET", "/v1/admin/incidents?status=open", admin);
  assert.equal(open.incidents.length, 2);
  assert.equal((await call("POST", `/v1/admin/incidents/${inc.incident.id}/close`, admin, {})).status, 422, "say how it was resolved");
  const closed = await ok("POST", `/v1/admin/incidents/${inc.incident.id}/close`, admin, { note: "Partner's insurer is covering the repair." });
  assert.equal(closed.incident.status, "closed");
  assert.equal((await ok("GET", "/v1/admin/incidents?status=open", admin)).incidents.length, 1);
  assert.equal((await call("GET", "/v1/admin/incidents", pa)).status, 403);
});
