import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startTestApp, customer, partner } from "./helpers.js";
import { milesBetween, maskContacts, createGeocoder } from "../src/maps/geo.js";

const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;
let clock = Date.parse("2026-11-03T14:00:00Z");
const tick = (ms) => { clock += ms; };

// A pretend Google Geocoding API. Addresses are placed at known spots around Knoxville.
const SPOTS = {
  "123 Kingston Pike": [35.9460, -83.9400], // the customer
  "10 Near St": [35.9600, -83.9200], //        ~1.5 mi away
  "20 Mid Rd": [36.0300, -83.9100], //         ~6 mi away
  "30 Far Hwy": [36.2800, -83.8800], //        ~23 mi away
};
let googleDown = false;
const fakeGoogle = async (url) => {
  const address = decodeURIComponent(new URL(url).searchParams.get("address"));
  assert.ok(new URL(url).searchParams.get("key"), "sends the API key");
  if (googleDown) return { json: async () => ({ status: "UNKNOWN_ERROR", results: [] }) };
  const spot = Object.entries(SPOTS).find(([street]) => address.startsWith(street));
  if (!spot) return { json: async () => ({ status: "ZERO_RESULTS", results: [] }) };
  return { json: async () => ({ status: "OK", results: [{ types: ["street_address"], geometry: { location: { lat: spot[1][0], lng: spot[1][1] } } }] }) };
};

let app, cust, near, mid, far, vehicleId, placeId;
const call = (m, p, token, body) => app.call(m, p, { token, body });
const ok = async (m, p, token, body, status = 200) => {
  const r = await call(m, p, token, body);
  assert.equal(r.status, status, `${m} ${p} → ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
};

before(async () => {
  app = await startTestApp({ GOOGLE_MAPS_API_KEY: "test-key" }, { now: () => clock, mapsFetch: fakeGoogle });
  cust = (await call("POST", "/v1/auth/signup", null, customer({ email: "d@example.com" }))).body.token;
  const ad = await call("POST", "/v1/auth/signup", null, customer({ email: "dops@example.com" }));
  await app.db.run(`UPDATE users SET role = 'admin' WHERE id = $1`, [ad.body.user.id]);
  const mk = async (email, street, radius) => {
    const r = await call("POST", "/v1/auth/signup", null, partner({ email }));
    await ok("POST", `/v1/admin/partners/${r.body.user.id}/status`, ad.body.token, { status: "active" });
    await ok("PUT", "/v1/partner/services", r.body.token, { serviceIds: ["oil_change", "jump_start"] });
    const a = await ok("PUT", "/v1/partner/service-area", r.body.token, { street, city: "Knoxville", state: "TN", zip: "37919", radiusMiles: radius });
    assert.equal(a.serviceArea.onMap, true);
    return r.body.token;
  };
  near = await mk("near@example.com", "10 Near St", 10);
  mid = await mk("mid@example.com", "20 Mid Rd", 15);
  far = await mk("far@example.com", "30 Far Hwy", 15);
  vehicleId = (await ok("POST", "/v1/vehicles", cust, { year: 2015, make: "Honda", model: "Civic" }, 201)).vehicle.id;
  placeId = (await ok("POST", "/v1/places", cust, { label: "Home", street: "123 Kingston Pike", city: "Knoxville", state: "TN", zip: "37919" }, 201)).place.id;
});
after(async () => { await app.close(); });

test("map helpers: distance, contact hiding, and no key means no geocoder", () => {
  assert.ok(Math.abs(milesBetween({ lat: 35.946, lng: -83.94 }, { lat: 36.03, lng: -83.91 }) - 6.0) < 0.3);
  assert.equal(maskContacts("Call me at (865) 555-0100 or 865.555.0100 or text 8655550100, email me@x.com"), "Call me at [number hidden] or [number hidden] or text [number hidden], email [email hidden]");
  assert.equal(maskContacts("Gate code 4411, unit 12"), "Gate code 4411, unit 12", "short numbers stay");
  assert.equal(createGeocoder({ apiKey: null }), null);
});

test("addresses Google can't find are explained; a Google outage doesn't block saving", async () => {
  const r = await call("POST", "/v1/places", cust, { label: "Work", street: "1 Nowhere Rd", city: "Knoxville", state: "TN", zip: "37902" });
  assert.equal(r.status, 422);
  assert.match(r.body.error.fields.street, /couldn't find that address/);
  googleDown = true;
  const p = await ok("POST", "/v1/places", cust, { label: "Work", street: "800 Market St", city: "Knoxville", state: "TN", zip: "37902" }, 201);
  googleDown = false;
  const row = await app.db.get(`SELECT geo_status, lat FROM places WHERE id = $1`, [p.place.id]);
  assert.deepEqual([row.geo_status, row.lat], ["error", null]);
  await ok("DELETE", `/v1/places/${p.place.id}`, cust, undefined, 204);
});

test("instant jobs: closest partner first, 30 seconds each; then everyone in range", async () => {
  const job = (await ok("POST", "/v1/jobs", cust, { vehicleId, placeId, serviceIds: ["oil_change"], kind: "asap" }, 201)).job;
  let offers = (await ok("GET", "/v1/jobs/offers", near)).offers;
  assert.equal(offers.length, 1, "closest partner gets the first offer");
  assert.equal(offers[0].secondsLeft, 30);
  assert.ok(offers[0].distanceMiles > 1 && offers[0].distanceMiles < 2.5);
  assert.equal(offers[0].job.place, null, "address still hidden in the offer");
  assert.equal((await ok("GET", "/v1/jobs/offers", mid)).offers.length, 0);
  assert.equal((await ok("GET", "/v1/jobs/board", mid)).jobs.length, 0, "not on the board while offers go out");
  const blocked = await call("POST", `/v1/jobs/${job.id}/accept`, mid);
  assert.equal(blocked.status, 409);
  assert.match(blocked.body.error.message, /offered to another partner/);

  await ok("POST", `/v1/jobs/${job.id}/decline-offer`, near);
  offers = (await ok("GET", "/v1/jobs/offers", mid)).offers;
  assert.equal(offers.length, 1, "declining sends it to the next closest right away");
  tick(31_000);
  assert.equal((await ok("GET", "/v1/jobs/offers", mid)).offers.length, 0, "offer ran out");
  const board = await ok("GET", "/v1/jobs/board", near);
  assert.ok(board.jobs.some((j) => j.id === job.id), "after the in-range partners had a turn, everyone in range can take it");
  assert.ok(!(await ok("GET", "/v1/jobs/board", far)).jobs.some((j) => j.id === job.id), "23 miles is outside a 15-mile circle");
  assert.equal((await call("POST", `/v1/jobs/${job.id}/accept`, far)).status, 409);

  const c = (await ok("GET", `/v1/jobs/${job.id}`, cust)).job;
  assert.deepEqual(c.timeline.map((e) => e.kind), ["booked", "offer_sent", "offer_declined", "offer_sent", "offer_expired", "sent_to_all"]);
  await ok("POST", `/v1/jobs/${job.id}/cancel`, cust, {});
});

test("halfway through the window the search widens to 35 miles", async () => {
  const job = (await ok("POST", "/v1/jobs", cust, { vehicleId, placeId, serviceIds: ["oil_change"], kind: "asap" }, 201)).job;
  await ok("POST", `/v1/jobs/${job.id}/decline-offer`, near);
  await ok("POST", `/v1/jobs/${job.id}/decline-offer`, mid);
  assert.ok(!(await ok("GET", "/v1/jobs/board", far)).jobs.some((j) => j.id === job.id));
  tick(2 * HOUR + MIN);
  const b = await ok("GET", "/v1/jobs/board", far);
  const j = b.jobs.find((x) => x.id === job.id);
  assert.ok(j, "the far partner sees it after the search widens");
  assert.ok(j.distanceMiles > 20 && j.driveMinutes > 40);
  const a = await ok("POST", `/v1/jobs/${job.id}/accept`, far);
  assert.equal(a.job.status, "confirmed");
  const c = (await ok("GET", `/v1/jobs/${job.id}`, cust)).job;
  assert.ok(c.timeline.some((e) => e.kind === "search_widened" && e.miles === 35));
  await ok("POST", `/v1/jobs/${job.id}/cancel`, cust, {});
});

test("an offered partner can accept; other offers end", async () => {
  const job = (await ok("POST", "/v1/jobs", cust, { vehicleId, placeId, serviceIds: ["jump_start"], kind: "roadside" }, 201)).job;
  const o = (await ok("GET", "/v1/jobs/offers", near)).offers[0];
  assert.equal(o.job.kind, "roadside");
  const a = await ok("POST", `/v1/jobs/${job.id}/accept`, near);
  assert.equal(a.job.status, "confirmed");
  assert.equal((await ok("GET", "/v1/jobs/offers", near)).offers.length, 0);
  const row = await app.db.get(`SELECT status FROM job_offers WHERE job_id = $1`, [job.id]);
  assert.equal(row.status, "accepted");
  await ok("POST", `/v1/jobs/${job.id}/cancel`, cust, {});
});

test("scheduled jobs go on the board for partners in range", async () => {
  const job = (await ok("POST", "/v1/jobs", cust, { vehicleId, placeId, serviceIds: ["oil_change"], kind: "scheduled", windowStart: clock + 2 * DAY }, 201)).job;
  assert.equal((await ok("GET", "/v1/jobs/offers", near)).offers.length, 0);
  assert.ok((await ok("GET", "/v1/jobs/board", near)).jobs.some((j) => j.id === job.id));
  assert.ok((await ok("GET", "/v1/jobs/board", mid)).jobs.some((j) => j.id === job.id));
  assert.ok(!(await ok("GET", "/v1/jobs/board", far)).jobs.some((j) => j.id === job.id));
  await ok("POST", `/v1/jobs/${job.id}/cancel`, cust, {});
});

test("chat: customer and partner only, phone numbers hidden, closes a day after the job", async () => {
  const job = (await ok("POST", "/v1/jobs", cust, { vehicleId, placeId, serviceIds: ["oil_change"], kind: "scheduled", windowStart: clock + 3 * HOUR }, 201)).job;
  assert.equal((await call("GET", `/v1/jobs/${job.id}/messages`, cust)).status, 404, "no chat before a partner is confirmed");
  await ok("POST", `/v1/jobs/${job.id}/accept`, near);
  const sent = await ok("POST", `/v1/jobs/${job.id}/messages`, cust, { body: "Call me at 865-555-0100 when you're close" }, 201);
  assert.equal(sent.hidden, true);
  await ok("POST", `/v1/jobs/${job.id}/messages`, near, { body: "Will do. About 20 minutes out." }, 201);
  const m = await ok("GET", `/v1/jobs/${job.id}/messages`, near);
  assert.deepEqual(m.messages.map((x) => [x.from, x.mine, x.body]), [
    ["customer", false, "Call me at [number hidden] when you're close"],
    ["partner", true, "Will do. About 20 minutes out."],
  ]);
  assert.equal((await call("GET", `/v1/jobs/${job.id}/messages`, mid)).status, 404, "other partners can't read it");
  const r = await call("POST", `/v1/jobs/${job.id}/messages`, cust, { body: "" });
  assert.match(r.body.error.fields.body, /Type a message/);

  await ok("POST", `/v1/jobs/${job.id}/start-trip`, near);
  await ok("POST", `/v1/jobs/${job.id}/arrive`, near);
  await ok("POST", `/v1/jobs/${job.id}/check-in`, near, { odometer: 50000 });
  const INSPECTION = Object.fromEntries(["brakes", "tires", "fluids", "battery", "wipers", "lights", "belts_hoses", "filters"].map((k) => [k, { status: "good" }]));
  await ok("POST", `/v1/jobs/${job.id}/complete`, near, { inspection: INSPECTION });
  assert.equal((await ok("GET", `/v1/jobs/${job.id}/messages`, cust)).canSend, true, "open for a day after");
  tick(DAY + MIN);
  assert.equal((await ok("GET", `/v1/jobs/${job.id}/messages`, cust)).canSend, false);
  assert.equal((await call("POST", `/v1/jobs/${job.id}/messages`, cust, { body: "Thanks!" })).status, 409);
});

test("addresses saved before maps were turned on get located", async () => {
  await app.db.run(`UPDATE places SET lat = NULL, lng = NULL, geo_status = NULL WHERE id = $1`, [placeId]);
  await app.db.run(`UPDATE partner_service_areas SET lat = NULL, lng = NULL, geo_status = NULL`);
  const r = await app.jobs.backfillLocations();
  assert.deepEqual(r, { places: 1, areas: 3 });
  assert.equal((await app.db.get(`SELECT geo_status FROM places WHERE id = $1`, [placeId])).geo_status, "ok");
});
