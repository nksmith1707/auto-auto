import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startTestApp, customer, partner } from "./helpers.js";
import { DEFAULTS, checkChanges } from "../src/pricing/settings.js";
import { priceLine, customerTotal, partnerPay, glassQuote, fleetLine, markupPct, vehicleFactor } from "../src/pricing/engine.js";
import { SERVICES } from "../src/catalog/services.js";
import { RATES } from "../src/pricing/rates.js";

const S = DEFAULTS;
const civic = { make: "Honda", model: "Civic", year: 2015 };
const f150 = { make: "Ford", model: "F-150", year: 2019 };
const $ = (c) => c / 100;

// ---------- Engine (pure) ----------

test("every catalog service has pricing", () => {
  for (const s of SERVICES) assert.ok(RATES[s.id], `${s.id} has a rate`);
});

test("parts markup tiers and fluids", () => {
  assert.equal(markupPct(49.99, S), 50);
  assert.equal(markupPct(50, S), 35);
  assert.equal(markupPct(199.99, S), 35);
  assert.equal(markupPct(200, S), 25);
  assert.equal(markupPct(500, S), 15);
  assert.equal(markupPct(31, S, { fluid: true }), 30);
});

test("book-time services: labor at $100/hr plus marked-up parts, with a shop comparison", () => {
  const oil = priceLine("oil_change", civic, S);
  assert.deepEqual([oil.hours, $(oil.laborCents), $(oil.partsPriceCents), $(oil.priceCents)], [0.4, 40, 40, 80]);
  const brakes = priceLine("brakes", civic, S);
  assert.deepEqual([$(brakes.laborCents), $(brakes.partsPriceCents), $(brakes.priceCents)], [150, 203, 353]);
  assert.ok(brakes.shopPriceCents > brakes.priceCents, "cheaper than a typical shop");
  assert.equal($(brakes.shopPriceCents), 210 + 263);
});

test("bigger vehicles take longer", () => {
  assert.equal(vehicleFactor(f150), 1.1);
  assert.equal(vehicleFactor(civic), 1);
  assert.equal(priceLine("brakes", f150, S).hours, 1.7);
});

test("quick fixes are flat labor plus parts at cost + 15%", () => {
  const h = priceLine("quick_headlight_bulb", civic, S);
  assert.deepEqual([$(h.laborCents), $(h.partsPriceCents), $(h.priceCents)], [25, 27.6, 52.6]);
  assert.equal($(priceLine("quick_key_fob", civic, S).priceCents), 10);
});

test("fixed prices, the Diagnose It visit, and quoted glass", () => {
  const cc = priceLine("ceramic_coat", civic, S);
  assert.deepEqual([$(cc.priceCents), $(cc.laborCents), $(cc.partsCostCents)], [350, 270, 80]);
  assert.equal($(priceLine("diagnostics", civic, S).priceCents), 49);
  const ws = priceLine("glass_windshield", civic, S);
  assert.equal(ws.priceCents, null);
  assert.deepEqual(ws.typicalCents.map($), [250, 600]);
  assert.equal($(priceLine("glass_chip", civic, S).priceCents), 58);
});

test("visit total: one mobile fee per visit, $3 protection, deposit over $300", () => {
  const oil = customerTotal([priceLine("oil_change", civic, S), priceLine("tire_rotation", civic, S)], S);
  assert.deepEqual(oil.fees.map((f) => [f.id, $(f.cents)]), [["mobile", 15], ["protection", 3]]);
  assert.equal($(oil.totalCents), 80 + 40 + 18);
  assert.equal(oil.depositCents, 0);
  const brakes = customerTotal([priceLine("brakes", civic, S)], S);
  assert.equal($(brakes.totalCents), 371);
  assert.equal($(brakes.depositCents), 150, "parts cost is higher than 25% of the total");
  assert.equal(brakes.holdHoursBefore, 24);
  const plus = customerTotal([priceLine("oil_change", civic, S)], S, { plus: true });
  assert.equal($(plus.totalCents), 80, "Plus waives mobile and protection fees");
  const credit = customerTotal([priceLine("brakes", civic, S)], S, { diagCredit: true });
  assert.equal($(credit.totalCents), 371 - 49);
});

test("partner pay: labor minus 20%, plus the mobile fee, at least $35, parts at cost on top", () => {
  const brakes = partnerPay([priceLine("brakes", civic, S)], S);
  assert.deepEqual([$(brakes.laborCents), $(brakes.feeCents), $(brakes.visitFeeCents), $(brakes.earningsCents), $(brakes.partsReimbursedCents)], [150, 30, 15, 135, 150]);
  assert.equal($(brakes.platformCents), 30 + 53, "fee plus parts margin");
  const fob = partnerPay([priceLine("quick_key_fob", civic, S)], S);
  assert.deepEqual([$(fob.earningsCents), $(fob.topUpCents)], [35, 12], "small jobs are topped up to the minimum");
  assert.equal($(fob.platformCents), 2 - 12, "Auto-Auto pays the top-up");
});

test("glass quote: cost + 15% + $28 kit + book labor + calibration, flagged above the typical range", () => {
  const q = glassQuote({ serviceId: "glass_windshield", glassCostCents: 28950, needsCalibration: false, vehicle: civic }, S);
  assert.deepEqual([$(q.glassPriceCents), $(q.kitCents), $(q.laborCents), $(q.priceCents), q.needsSupplierQuote], [332.93, 28, 150, 510.93, false]);
  const cal = glassQuote({ serviceId: "glass_windshield", glassCostCents: 28950, needsCalibration: true, vehicle: civic }, S);
  assert.deepEqual([$(cal.calibrationCents), $(cal.priceCents), cal.needsSupplierQuote], [250, 760.93, true]);
  assert.throws(() => glassQuote({ serviceId: "oil_change", glassCostCents: 100 }, S), /Only glass/);
});

test("fleet: fleet labor rate, parts + 10%, class factors, services that don't fit are skipped", () => {
  const oil = fleetLine("oil_change", "box_truck", S);
  assert.deepEqual([oil.hours, $(oil.laborCents), $(oil.partsPriceCents), $(oil.priceCents)], [0.6, 51, 85.25, 136.25]);
  assert.equal(fleetLine("oil_change", "trailer", S).offered, false);
  assert.equal(fleetLine("brakes", "trailer", S).offered, true);
  assert.equal($(fleetLine("dot_annual", "tractor", S).priceCents), 130.8);
  assert.equal($(fleetLine("fleet_wash", "box_truck", S).priceCents), 47.5, "washing uses the $60/hr wash rate");
  assert.equal(fleetLine("quick_wipers", "van_pickup", S).offered, false);
  assert.equal($(fleetLine("oil_change", "van_pickup", S, { laborRate: 75 }).laborCents), 30, "each fleet can have its own rate");
  const visit = customerTotal([oil], S, { fleet: true });
  assert.deepEqual(visit.fees.map((f) => [f.id, $(f.cents)]), [["trip", 25]], "one trip fee, no mobile or protection fee");
});

test("settings checks explain what's wrong", () => {
  assert.throws(() => checkChanges({}), (e) => !!e.extra.fields.changes);
  assert.throws(() => checkChanges({ labor: "abc", teleport: 1, cancelH: 2.5, fee: 90 }), (e) => {
    const f = e.extra.fields;
    return /number/.test(f.labor) && /isn't a setting/.test(f.teleport) && /whole number/.test(f.cancelH) && /between 0 and 60/.test(f.fee);
  });
  assert.deepEqual(checkChanges({ labor: "110", plus: 10.989 }), { labor: 110, plus: 10.99 });
});

// ---------- API ----------

let app, cust, part, admin, vehicleId;
before(async () => {
  app = await startTestApp();
  cust = (await app.call("POST", "/v1/auth/signup", { body: customer({ email: "price@example.com" }) })).body.token;
  part = (await app.call("POST", "/v1/auth/signup", { body: partner({ email: "pp@example.com" }) })).body.token;
  const a = await app.call("POST", "/v1/auth/signup", { body: customer({ email: "boss@example.com" }) });
  await app.db.run(`UPDATE users SET role = 'admin' WHERE id = $1`, [a.body.user.id]);
  admin = a.body.token;
  vehicleId = (await app.call("POST", "/v1/vehicles", { token: cust, body: { year: 2019, make: "Ford", model: "F-150" } })).body.vehicle.id;
});
after(async () => { await app.close(); });

test("live settings start at version 1 with the design-phase numbers", async () => {
  const r = await app.call("GET", "/v1/pricing/settings", { token: part });
  assert.equal(r.status, 200);
  assert.equal(r.body.version, 1);
  assert.equal(r.body.settings.labor, 100);
  assert.equal(r.body.meta.length, Object.keys(DEFAULTS).length);
  assert.equal((await app.call("GET", "/v1/pricing/settings")).status, 401);
});

test("customer menu: prices for their own vehicle, no partner pay, no fleet services", async () => {
  const r = await app.call("GET", `/v1/pricing/menu?vehicleId=${vehicleId}`, { token: cust });
  assert.equal(r.status, 200);
  const brakes = r.body.items.find((i) => i.serviceId === "brakes");
  assert.equal(brakes.hours, 1.7, "F-150 takes longer");
  assert.equal(brakes.partnerEarnsCents, undefined);
  assert.equal(brakes.partsCostCents, undefined);
  assert.ok(!r.body.items.some((i) => i.category === "fleet"));
  assert.equal(r.body.sampleBookTimes, true);
  const other = await app.call("POST", "/v1/auth/signup", { body: customer({ email: "nosy@example.com" }) });
  assert.equal((await app.call("GET", `/v1/pricing/menu?vehicleId=${vehicleId}`, { token: other.body.token })).status, 404);
});

test("partner menu shows what they'd earn per job", async () => {
  const r = await app.call("GET", "/v1/pricing/menu?make=Honda&model=Civic", { token: part });
  const oil = r.body.items.find((i) => i.serviceId === "oil_change");
  assert.equal($(oil.partnerEarnsCents), 47);
  assert.ok(r.body.items.some((i) => i.category === "fleet"));
});

test("quotes: totals, deposit, and the right amount of detail for each role", async () => {
  let r = await app.call("POST", "/v1/quotes", { token: cust, body: { vehicleId, serviceIds: ["oil_change", "brakes"] } });
  assert.equal(r.status, 200);
  assert.equal(r.body.settingsVersion, 1);
  assert.equal($(r.body.quote.totalCents), 80 + (170 + 203) + 15 + 3, "F-150 brakes are 1.7 hr");
  assert.ok(r.body.quote.depositCents > 0);
  assert.equal(r.body.partnerPay, undefined);

  r = await app.call("POST", "/v1/quotes", { token: part, body: { make: "Honda", model: "Civic", serviceIds: ["brakes"] } });
  assert.equal($(r.body.partnerPay.earningsCents), 135);
  assert.equal(r.body.partnerPay.platformCents, undefined);
  r = await app.call("POST", "/v1/quotes", { token: admin, body: { make: "Honda", model: "Civic", serviceIds: ["brakes"] } });
  assert.equal($(r.body.partnerPay.platformCents), 83);

  r = await app.call("POST", "/v1/quotes", { token: cust, body: { vehicleId, serviceIds: ["glass_windshield", "oil_change"] } });
  assert.deepEqual(r.body.quote.pending.map((p) => p.serviceId), ["glass_windshield"], "glass waits for the partner's quote");

  for (const [body, re] of [[{ serviceIds: [] }, /at least one/], [{ serviceIds: ["oil_change", "oil_change"] }, /only be added once/], [{ serviceIds: ["dot_annual"] }, /fleet account/]]) {
    r = await app.call("POST", "/v1/quotes", { token: cust, body: { vehicleId, ...body } });
    assert.equal(r.status, 422);
    assert.match(r.body.error.fields.serviceIds, re);
  }
  r = await app.call("POST", "/v1/quotes", { token: cust, body: { vehicleId, serviceIds: ["teleport"] } });
  assert.equal(r.status, 422);
  assert.match(r.body.error.message, /can't price/);
});

test("glass quote endpoint for partners", async () => {
  let r = await app.call("POST", "/v1/quotes/glass", { token: part, body: { serviceId: "glass_windshield", glassCost: "289.50", needsCalibration: true, make: "Honda", model: "Civic" } });
  assert.equal(r.status, 200);
  assert.equal($(r.body.glass.priceCents), 760.93);
  assert.equal(r.body.glass.needsSupplierQuote, true);
  assert.equal($(r.body.quote.totalCents), 760.93 + 18);
  r = await app.call("POST", "/v1/quotes/glass", { token: part, body: { serviceId: "glass_windshield", glassCost: 0 } });
  assert.match(r.body.error.fields.glassCost, /supplier/);
  assert.equal((await app.call("POST", "/v1/quotes/glass", { token: cust, body: {} })).status, 403);
});

test("admins publish a new version with a note; quotes use it from then on", async () => {
  assert.equal((await app.call("POST", "/v1/pricing/settings", { token: part, body: { changes: { labor: 110 }, note: "test" } })).status, 403);

  let r = await app.call("POST", "/v1/pricing/settings", { token: admin, body: { changes: { labor: 110 }, note: "" } });
  assert.equal(r.status, 422);
  assert.match(r.body.error.fields.note, /why/);
  r = await app.call("POST", "/v1/pricing/settings", { token: admin, body: { changes: { labor: 100 }, note: "No real change here" } });
  assert.match(r.body.error.fields.changes, /already the live values/);

  r = await app.call("POST", "/v1/pricing/settings", { token: admin, body: { changes: { labor: 110, minPay: 40 }, note: "Raise labor to $110/hr", expectedVersion: 1 } });
  assert.equal(r.status, 201);
  assert.equal(r.body.version, 2);

  r = await app.call("POST", "/v1/pricing/settings", { token: admin, body: { changes: { mobile: 20 }, note: "Stale editor", expectedVersion: 1 } });
  assert.equal(r.status, 409);
  assert.match(r.body.error.message, /version 2/);

  const q = await app.call("POST", "/v1/quotes", { token: cust, body: { vehicleId, serviceIds: ["oil_change"] } });
  assert.equal(q.body.settingsVersion, 2);
  assert.equal($(q.body.quote.lines[0].laborCents), 44);

  const h = await app.call("GET", "/v1/pricing/settings/history", { token: admin });
  assert.deepEqual(h.body.versions.map((v) => v.version), [2, 1]);
  assert.deepEqual(h.body.versions[0].changes, [{ key: "labor", from: 100, to: 110 }, { key: "minPay", from: 35, to: 40 }]);
  assert.equal(h.body.versions[0].note, "Raise labor to $110/hr");
  assert.equal((await app.call("GET", "/v1/pricing/settings/history", { token: cust })).status, 403);

  const v1 = await app.settings.version(1);
  assert.equal(v1.settings.labor, 100, "old versions never change, so old bookings keep their prices");
});
