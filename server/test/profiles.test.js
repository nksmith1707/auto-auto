import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startTestApp, customer, partner } from "./helpers.js";
import { localDecode, checkDigit, vinProblem, fromVpic } from "../src/vehicles/vin.js";

// A fake NHTSA vPIC service. Counts calls so we can check caching.
let vpicCalls = 0;
let vpicMode = "ok";
const fakeVpic = async (url) => {
  vpicCalls++;
  if (vpicMode === "down") throw new Error("connect ECONNREFUSED");
  const vin = url.split("/").pop().split("?")[0];
  const Results = [vin.startsWith("5YJ")
    ? { Make: "TESLA", Model: "Model 3", ModelYear: "2019", Trim: "Long Range", FuelTypePrimary: "Electric", ElectrificationLevel: "BEV (Battery Electric Vehicle)", BodyClass: "Sedan/Saloon", ErrorCode: "0" }
    : { Make: "HONDA", Model: "Accord", ModelYear: "2003", Trim: "EX", Series: "", FuelTypePrimary: "Gasoline", ElectrificationLevel: "", DisplacementL: "2.4", EngineCylinders: "4", BodyClass: "Coupe", ErrorCode: "0" }];
  return { ok: true, json: async () => ({ Count: 1, Results }) };
};

let app, cust, cust2, part;
before(async () => {
  app = await startTestApp({}, { vinFetch: fakeVpic });
  cust = (await app.call("POST", "/v1/auth/signup", { body: customer({ email: "veh@example.com" }) })).body.token;
  cust2 = (await app.call("POST", "/v1/auth/signup", { body: customer({ email: "other@example.com" }) })).body.token;
  part = (await app.call("POST", "/v1/auth/signup", { body: partner({ email: "p@example.com" }) })).body.token;
});
after(async () => { await app.close(); });

const ACCORD = "1HGCM82633A004352";
const TESLA = "5YJ3E1EA1KF123456";

test("VIN rules: check digit, model year, and plain-English problems", () => {
  assert.equal(checkDigit(ACCORD), "3");
  const d = localDecode(ACCORD);
  assert.deepEqual([d.checkDigitOk, d.year, d.make], [true, 2003, "Honda"]);
  assert.equal(localDecode("5FPYK1F55AB000123").year, 2010, "letter in position 7 means 2010 or later");
  assert.match(vinProblem("1HGCM8263").problem, /17 characters/);
  assert.match(vinProblem("1HGCM82633A00435O").problem, /I, O, or Q/);
  assert.equal(vinProblem(" 1hgcm8263-3a004352 ").vin, ACCORD);
  assert.deepEqual(fromVpic({ Make: "GMC", Model: "Sierra", FuelTypePrimary: "Diesel" }).fuel, "diesel");
  assert.equal(fromVpic({ Make: "TOYOTA", FuelTypePrimary: "Gasoline", ElectrificationLevel: "Strong HEV (Hybrid Electric Vehicle)" }).fuel, "hybrid");
});

test("VIN lookup fills in model and trim, and caches the answer", async () => {
  const r = await app.call("GET", `/v1/vin/${ACCORD.toLowerCase()}`, { token: cust });
  assert.equal(r.status, 200);
  assert.deepEqual(
    { make: r.body.vin.make, model: r.body.vin.model, trim: r.body.vin.trim, year: r.body.vin.year, fuel: r.body.vin.fuel, engine: r.body.vin.engine, source: r.body.vin.source },
    { make: "Honda", model: "Accord", trim: "EX", year: 2003, fuel: "gas", engine: "2.4L 4-cyl", source: "nhtsa" },
  );
  const calls = vpicCalls;
  await app.call("GET", `/v1/vin/${ACCORD}`, { token: cust });
  assert.equal(vpicCalls, calls, "second lookup comes from the cache");
});

test("VIN lookup still works when NHTSA is down, and flags a wrong check digit", async () => {
  vpicMode = "down";
  const r = await app.call("GET", `/v1/vin/${TESLA}`, { token: cust });
  vpicMode = "ok";
  assert.equal(r.status, 200);
  assert.equal(r.body.vin.make, "Tesla");
  assert.equal(r.body.vin.model, null);
  assert.equal(r.body.vin.source, "vin");
  const bad = await app.call("GET", `/v1/vin/1HGCM82634A004352`, { token: cust });
  assert.equal(bad.body.vin.checkDigitOk, false);
  assert.match(bad.body.message, /doesn't add up/);
  const short = await app.call("GET", `/v1/vin/1HGCM826`, { token: cust });
  assert.equal(short.status, 422);
  assert.match(short.body.error.fields.vin, /17 characters/);
});

test("customers add, list, edit, and remove vehicles", async () => {
  const add = await app.call("POST", "/v1/vehicles", { token: cust, body: { year: 2015, make: "Honda", model: "Civic", trim: "LX", vin: ACCORD, plate: "cvx-2015", plateState: "tn", mileage: "84,200", fuel: "Gas", oilPreference: "Full synthetic 0W-20", nickname: "Daily" } });
  assert.equal(add.status, 201);
  const v = add.body.vehicle;
  assert.deepEqual([v.plate, v.plateState, v.mileage, v.fuel], ["CVX-2015", "TN", 84200, "gas"]);

  const dup = await app.call("POST", "/v1/vehicles", { token: cust, body: { year: 2003, make: "Honda", model: "Accord", vin: ACCORD } });
  assert.equal(dup.status, 409);
  assert.equal(dup.body.error.code, "vin_taken");

  const edit = await app.call("PATCH", `/v1/vehicles/${v.id}`, { token: cust, body: { mileage: 85000, color: "White" } });
  assert.equal(edit.status, 200);
  assert.deepEqual([edit.body.vehicle.mileage, edit.body.vehicle.color, edit.body.vehicle.model], [85000, "White", "Civic"]);

  const list = await app.call("GET", "/v1/vehicles", { token: cust });
  assert.equal(list.body.vehicles.length, 1);
  assert.ok(list.body.options.oils.includes("High mileage"));

  assert.equal((await app.call("DELETE", `/v1/vehicles/${v.id}`, { token: cust })).status, 204);
  assert.equal((await app.call("GET", "/v1/vehicles", { token: cust })).body.vehicles.length, 0);
  const again = await app.call("POST", "/v1/vehicles", { token: cust, body: { year: 2003, make: "Honda", model: "Accord", vin: ACCORD } });
  assert.equal(again.status, 201, "a removed vehicle's VIN can be added again");
  const row = await app.db.get(`SELECT archived_at FROM vehicles WHERE id = $1`, [v.id]);
  assert.ok(row.archived_at, "removed vehicles are archived, not erased, so past jobs keep their history");
});

test("vehicle fields are checked with clear messages", async () => {
  const r = await app.call("POST", "/v1/vehicles", { token: cust, body: { year: 1975, make: "", model: "x".repeat(41), vin: "123", mileage: -5, fuel: "steam", oilPreference: "Motor honey", plateState: "XX", plate: "AB$1" } });
  assert.equal(r.status, 422);
  const f = r.body.error.fields;
  assert.match(f.year, /between 1,981 and/);
  assert.equal(f.make, "Enter the make.");
  assert.match(f.model, /under 40/);
  assert.match(f.vin, /17 characters/);
  assert.match(f.mileage, /between 0/);
  assert.match(f.fuel, /gas, diesel, hybrid, or electric/);
  assert.match(f.oilPreference, /from the list/);
  assert.match(f.plateState, /2-letter/);
  assert.match(f.plate, /letters, numbers/);
});

test("vehicles are private to their owner and to customers", async () => {
  const mine = (await app.call("GET", "/v1/vehicles", { token: cust })).body.vehicles[0];
  for (const [m, body] of [["GET"], ["PATCH", { color: "Red" }], ["DELETE"]]) {
    const r = await app.call(m, `/v1/vehicles/${mine.id}`, { token: cust2, body });
    assert.equal(r.status, 404, `${m} on someone else's vehicle`);
  }
  assert.equal((await app.call("GET", "/v1/vehicles", { token: part })).status, 403);
  assert.equal((await app.call("GET", "/v1/vehicles")).status, 401);
  assert.equal((await app.call("GET", `/v1/vin/${ACCORD}`, { token: part })).status, 403);
});

test("saved places: first is default, one default at a time, partners only get the area", async () => {
  const home = await app.call("POST", "/v1/places", { token: cust, body: { label: "Home", street: "123 Kingston Pike", city: "Knoxville", state: "tn", zip: "37919-4410", parking: "driveway", notes: "Gate code 4411" } });
  assert.equal(home.status, 201);
  assert.equal(home.body.place.isDefault, true);
  assert.equal(home.body.place.zip, "37919");
  assert.equal(home.body.place.area, "Knoxville, TN 37919");

  const work = await app.call("POST", "/v1/places", { token: cust, body: { label: "Work", street: "800 Market St", unit: "Suite 4", city: "Knoxville", state: "TN", zip: "37902", parking: "lot", isDefault: true } });
  assert.equal(work.body.place.isDefault, true);
  let list = (await app.call("GET", "/v1/places", { token: cust })).body.places;
  assert.deepEqual(list.map((p) => [p.label, p.isDefault]), [["Work", true], ["Home", false]]);

  const edit = await app.call("PATCH", `/v1/places/${home.body.place.id}`, { token: cust, body: { isDefault: true, notes: "" } });
  assert.equal(edit.body.place.isDefault, true);
  assert.equal(edit.body.place.notes, null);

  await app.call("DELETE", `/v1/places/${home.body.place.id}`, { token: cust });
  list = (await app.call("GET", "/v1/places", { token: cust })).body.places;
  assert.deepEqual(list.map((p) => [p.label, p.isDefault]), [["Work", true]], "default moves to a remaining place");

  assert.equal((await app.call("PATCH", `/v1/places/${work.body.place.id}`, { token: cust2, body: { label: "Mine" } })).status, 404);
  assert.equal((await app.call("GET", "/v1/places", { token: part })).status, 403);

  const bad = await app.call("POST", "/v1/places", { token: cust, body: { label: "", street: "", city: "Knoxville", state: "Tennessee", zip: "3791", parking: "roof" } });
  assert.equal(bad.status, 422);
  assert.deepEqual(Object.keys(bad.body.error.fields).sort(), ["label", "parking", "state", "street", "zip"]);
});

test("partners set their service area and the services they offer", async () => {
  let r = await app.call("GET", "/v1/partner/service-area", { token: part });
  assert.equal(r.body.serviceArea, null);
  assert.deepEqual(r.body.limits, { minMiles: 5, maxMiles: 60, stepMiles: 5 });

  r = await app.call("PUT", "/v1/partner/service-area", { token: part, body: { street: "45 Main St", city: "Maryville", state: "TN", zip: "37804", radiusMiles: 22 } });
  assert.equal(r.status, 422);
  assert.match(r.body.error.fields.radiusMiles, /steps of 5/);
  r = await app.call("PUT", "/v1/partner/service-area", { token: part, body: { street: "45 Main St", city: "Maryville", state: "TN", zip: "37804", radiusMiles: 20 } });
  assert.equal(r.status, 200);
  assert.equal(r.body.serviceArea.radiusMiles, 20);
  r = await app.call("PUT", "/v1/partner/service-area", { token: part, body: { street: "45 Main St", city: "Maryville", state: "TN", zip: "37804", radiusMiles: 35 } });
  assert.equal(r.body.serviceArea.radiusMiles, 35, "saving again updates");

  r = await app.call("GET", "/v1/partner/services", { token: part });
  assert.deepEqual(r.body.services, []);
  assert.ok(r.body.catalog.services.find((s) => s.id === "brakes").needsProof);

  r = await app.call("PUT", "/v1/partner/services", { token: part, body: { serviceIds: ["oil_change", "brakes", "oil_change", "jump_start"] } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.services.map((s) => s.id).sort(), ["brakes", "jump_start", "oil_change"]);
  r = await app.call("PUT", "/v1/partner/services", { token: part, body: { serviceIds: ["teleport"] } });
  assert.equal(r.status, 422);

  const me = await app.call("GET", "/v1/me", { token: part });
  assert.deepEqual(me.body.user.partner, { status: "applicant", serviceAreaSet: true, servicesCount: 3, payoutsEnabled: false });

  assert.equal((await app.call("GET", "/v1/partner/service-area", { token: cust })).status, 403);
  assert.equal((await app.call("PUT", "/v1/partner/services", { token: cust, body: { serviceIds: [] } })).status, 403);
});

test("everyone can edit their name and phone; partners must keep a phone", async () => {
  let r = await app.call("PATCH", "/v1/me", { token: cust, body: { firstName: " Jordan ", lastName: "Reese", phone: "865.555.0100" } });
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.user.firstName, r.body.user.lastName, r.body.user.phone], ["Jordan", "Reese", "+18655550100"]);
  r = await app.call("PATCH", "/v1/me", { token: cust, body: { phone: "" } });
  assert.equal(r.body.user.phone, null, "customers can remove their phone");
  r = await app.call("PATCH", "/v1/me", { token: part, body: { phone: "" } });
  assert.equal(r.status, 422);
  assert.match(r.body.error.fields.phone, /mobile number/);
  r = await app.call("PATCH", "/v1/me", { token: cust, body: { email: "new@example.com" } });
  assert.equal(r.status, 422);
  assert.match(r.body.error.fields.email, /Contact support/);
});

test("service catalog is available to signed-in users", async () => {
  const r = await app.call("GET", "/v1/catalog/services", { token: cust });
  assert.equal(r.status, 200);
  assert.ok(r.body.categories.length >= 5);
  assert.ok(r.body.services.every((s) => r.body.categories.some((c) => c.id === s.category)));
  assert.equal((await app.call("GET", "/v1/catalog/services")).status, 401);
});
