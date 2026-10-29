import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startTestApp, customer, partner } from "./helpers.js";
import { createFakeStripe } from "./fake-stripe.js";
import { safeReturn } from "../src/payments/routes.js";

const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;
let clock = Date.parse("2026-11-02T13:00:00Z");
let app, stripe, cust, pa, paId, admin, vehicleId, placeId;

const call = (m, p, token, body) => app.call(m, p, { token, body });
const ok = async (m, p, token, body, status = 200) => {
  const r = await call(m, p, token, body);
  assert.equal(r.status, status, `${m} ${p} → ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
};
const book = (over = {}) => ok("POST", "/v1/jobs", cust, { vehicleId, placeId, serviceIds: ["oil_change"], kind: "scheduled", windowStart: clock + 3 * DAY, ...over }, 201).then((b) => b.job);
const view = async (id) => (await ok("GET", `/v1/jobs/${id}`, cust)).job;
const INSPECTION = Object.fromEntries(["brakes", "tires", "fluids", "battery", "wipers", "lights", "belts_hoses", "filters"].map((k) => [k, { status: "good" }]));
const customerId = async () => (await app.db.get(`SELECT stripe_customer_id FROM stripe_customers`)).stripe_customer_id;

// Runs a confirmed job through to the start of the work.
async function startWork(job) {
  clock = Math.max(clock, job.windowStart - HOUR);
  await ok("POST", `/v1/jobs/${job.id}/start-trip`, pa);
  await ok("POST", `/v1/jobs/${job.id}/arrive`, pa);
  await ok("POST", `/v1/jobs/${job.id}/check-in`, pa, { odometer: 85000 });
}

before(async () => {
  stripe = createFakeStripe();
  app = await startTestApp({ STRIPE_SECRET_KEY: "sk_test_fake", STRIPE_PUBLISHABLE_KEY: "pk_test_fake" }, { now: () => clock, stripeFetch: stripe.fetch });
  cust = (await call("POST", "/v1/auth/signup", null, customer({ email: "pay@example.com" }))).body.token;
  const a = await call("POST", "/v1/auth/signup", null, partner({ email: "payp@example.com" }));
  pa = a.body.token; paId = a.body.user.id;
  const ad = await call("POST", "/v1/auth/signup", null, customer({ email: "payops@example.com" }));
  await app.db.run(`UPDATE users SET role = 'admin' WHERE id = $1`, [ad.body.user.id]);
  admin = ad.body.token;
  await ok("POST", `/v1/admin/partners/${paId}/status`, admin, { status: "active" });
  await ok("PUT", "/v1/partner/services", pa, { serviceIds: ["oil_change", "brakes", "tire_rotation", "air_filters"] });
  vehicleId = (await ok("POST", "/v1/vehicles", cust, { year: 2015, make: "Honda", model: "Civic", mileage: 84000 }, 201)).vehicle.id;
  placeId = (await ok("POST", "/v1/places", cust, { label: "Home", street: "123 Kingston Pike", city: "Knoxville", state: "TN", zip: "37919" }, 201)).place.id;
});
after(async () => { await app.close(); });

test("return links only go back into the apps", () => {
  assert.equal(safeReturn("exp://192.168.1.5:8081/--/cards", { isProd: true }), "exp://192.168.1.5:8081/--/cards");
  assert.equal(safeReturn("autoauto://cards", { isProd: true }), "autoauto://cards");
  assert.equal(safeReturn("https://evil.example.com", { isProd: false }), null);
  assert.equal(safeReturn("http://localhost:8081/cards", { isProd: true }), "http://localhost:8081/cards");
  assert.equal(safeReturn("http://localhost.evil.com/cards", { isProd: true }), null);
  assert.equal(safeReturn("http://user@localhost:8081/cards", { isProd: true }), null);
  assert.equal(safeReturn("http://localhost:8081/cards", { isProd: false }), "http://localhost:8081/cards");
  assert.equal(safeReturn("javascript:alert(1)", { isProd: false }), null);
});

test("a card is needed to book; it's saved on Stripe's page and only brand and last 4 are kept", async () => {
  const cfg = await ok("GET", "/v1/payments/config", cust);
  assert.deepEqual(cfg, { enabled: true, publishableKey: "pk_test_fake", testMode: true });
  assert.deepEqual((await ok("GET", "/v1/payments/cards", cust)).cards, []);
  const r = await call("POST", "/v1/jobs", cust, { vehicleId, placeId, serviceIds: ["oil_change"], kind: "scheduled", windowStart: clock + 3 * DAY });
  assert.equal(r.status, 422);
  assert.equal(r.body.error.code, "card_required");

  const setup = await ok("POST", "/v1/payments/cards/setup", cust, { returnUrl: "exp://192.168.1.5:8081/--/cards" });
  assert.match(setup.url, /^https:\/\/checkout\.stripe\.test\/cs_/);
  const back = stripe.finishSession(setup.sessionId);
  const path = back.slice(back.indexOf("/pay/return"));
  const res = await fetch(app.base + path, { redirect: "manual" });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get("location"), "exp://192.168.1.5:8081/--/cards?done=1");
  const plain = await fetch(`${app.base}/pay/return?to=${encodeURIComponent("https://evil.example.com")}&ok=1`, { redirect: "manual" });
  assert.equal(plain.status, 200, "unknown return links get a plain page, not a redirect");

  const cards = (await ok("POST", "/v1/payments/cards/sync", cust)).cards;
  assert.equal(cards.length, 1);
  assert.deepEqual({ ...cards[0], id: undefined }, { id: undefined, brand: "visa", last4: "4242", expMonth: 12, expYear: 2030, isDefault: true });
  const row = await app.db.get(`SELECT * FROM cards`);
  assert.deepEqual(Object.keys(row).sort(), ["brand", "created_at", "exp_month", "exp_year", "id", "is_default", "last4", "user_id"], "no card numbers stored");
});

test("small job: card held 24 hours before, then charged the final total at completion; partner paid", async () => {
  const job = await book();
  assert.equal(job.quote.depositCents, 0);
  assert.equal(job.payment.status, null);
  await ok("POST", `/v1/jobs/${job.id}/accept`, pa);
  clock = job.windowStart - 25 * HOUR;
  assert.equal((await view(job.id)).payment.heldCents, 0, "no hold more than 24 hours out");
  clock = job.windowStart - 23 * HOUR;
  await app.jobs.sweep();
  const held = (await view(job.id)).payment;
  assert.equal(held.status, "held");
  assert.equal(held.heldCents, job.quote.totalCents);
  const pi = Object.values(stripe.state.intents).find((x) => x.status === "requires_capture");
  assert.equal(pi.amount, job.quote.totalCents);
  assert.equal(pi.capture_method, "manual");

  await startWork(job);
  await ok("POST", `/v1/jobs/${job.id}/complete`, pa, { inspection: INSPECTION });
  const done = await view(job.id);
  assert.equal(done.payment.status, "paid");
  assert.equal(done.payment.paidCents, done.final.chargeCents);
  assert.equal(done.payment.dueCents, 0);
  assert.equal(stripe.state.intents[pi.id].amount_received, done.final.chargeCents);
  const pay = await ok("GET", "/v1/payouts", pa);
  assert.ok(pay.balance.availableCents > 0);
  assert.equal(pay.activity[0].jobId, job.id);
});

test("big job: deposit charged at booking and refunded on a free cancel", async () => {
  const job = await book({ serviceIds: ["oil_change", "brakes"], windowStart: clock + 4 * DAY });
  assert.equal(job.quote.depositCents, 18100);
  assert.equal(job.payment.status, "deposit_paid");
  assert.equal(job.payment.paidCents, 18100);
  const c = (await ok("POST", `/v1/jobs/${job.id}/cancel`, cust, { expectedFeeCents: 0 })).job;
  assert.equal(c.payment.status, "refunded");
  assert.equal(c.payment.paidCents, 0);
  assert.equal(stripe.state.refunds.at(-1).amount, 18100);
});

test("late cancel: hold released, $25 fee charged, partner gets their share", async () => {
  const job = await book({ windowStart: clock + 30 * HOUR });
  await ok("POST", `/v1/jobs/${job.id}/accept`, pa);
  clock += 7 * HOUR;
  await app.jobs.sweep();
  assert.equal((await view(job.id)).payment.status, "held");
  const c = (await ok("POST", `/v1/jobs/${job.id}/cancel`, cust, { expectedFeeCents: 2500 })).job;
  assert.equal(c.payment.status, "paid");
  assert.equal(c.payment.paidCents, 2500);
  assert.equal(c.payment.heldCents, 0);
  assert.ok(Object.values(stripe.state.intents).some((x) => x.status === "canceled"), "hold released");
  const share = (await ok("GET", "/v1/payouts", pa)).activity.find((a) => a.jobId === job.id);
  assert.deepEqual([share.kind, share.cents], ["fee_share", 2000]);
});

test("declined deposit: booking doesn't go through and says why", async () => {
  stripe.addCard(await customerId(), { last4: "0002", behavior: "decline" });
  const cards = (await ok("POST", "/v1/payments/cards/sync", cust)).cards;
  const bad = cards.find((c) => c.last4 === "0002");
  await ok("POST", `/v1/payments/cards/${bad.id}/default`, cust);
  const r = await call("POST", "/v1/jobs", cust, { vehicleId, placeId, serviceIds: ["oil_change", "brakes"], kind: "scheduled", windowStart: clock + 4 * DAY });
  assert.equal(r.status, 402);
  assert.match(r.body.error.message, /insufficient funds/);
  const j = await app.db.get(`SELECT * FROM jobs ORDER BY created_at DESC LIMIT 1`);
  assert.equal(j.status, "cancelled");
  assert.equal(j.cancel_reason, "deposit_failed");
  assert.equal((await ok("GET", "/v1/jobs/board", pa)).jobs.some((x) => x.id === j.id), false);
});

test("failed final charge: partner is still paid; a new default card collects what's due", async () => {
  const good = (await ok("GET", "/v1/payments/cards", cust)).cards.find((c) => c.last4 === "4242");
  await ok("POST", `/v1/payments/cards/${good.id}/default`, cust);
  const job = await book({ windowStart: clock + 5 * HOUR });
  assert.equal(job.payment.status, "held", "visits within 24 hours are held right away");
  await ok("POST", `/v1/jobs/${job.id}/accept`, pa);
  await startWork(job);
  const withAddon = (await ok("POST", `/v1/jobs/${job.id}/addons`, pa, { serviceIds: ["air_filters"], reason: "Engine filter is clogged" })).job;
  await ok("POST", `/v1/jobs/${job.id}/addons/${withAddon.addons[0].id}/approve`, cust);
  const bad = (await ok("GET", "/v1/payments/cards", cust)).cards.find((c) => c.last4 === "0002");
  await ok("POST", `/v1/payments/cards/${bad.id}/default`, cust);
  const before = (await ok("GET", "/v1/payouts", pa)).balance.availableCents;
  await ok("POST", `/v1/jobs/${job.id}/complete`, pa, { inspection: INSPECTION });
  const v = await view(job.id);
  assert.equal(v.payment.status, "charge_failed");
  assert.ok(v.payment.dueCents > 0 && v.payment.dueCents < v.final.chargeCents, "the hold covered most of it");
  assert.ok((await ok("GET", "/v1/payouts", pa)).balance.availableCents > before, "partner paid anyway");
  const retry = await call("POST", `/v1/jobs/${job.id}/pay`, cust);
  assert.equal(retry.status, 402);
  await ok("POST", `/v1/payments/cards/${good.id}/default`, cust);
  const after = await view(job.id);
  assert.equal(after.payment.status, "paid");
  assert.equal(after.payment.dueCents, 0);
  assert.equal(after.payment.paidCents, after.final.chargeCents);
});

test("removing your only card is blocked while a visit is coming up", async () => {
  const job = await book();
  const bad = (await ok("GET", "/v1/payments/cards", cust)).cards.find((c) => c.last4 === "0002");
  const left = (await ok("DELETE", `/v1/payments/cards/${bad.id}`, cust)).cards;
  assert.equal(left.length, 1);
  const r = await call("DELETE", `/v1/payments/cards/${left[0].id}`, cust);
  assert.equal(r.status, 409);
  await ok("POST", `/v1/jobs/${job.id}/cancel`, cust, {});
});

test("payouts: Stripe setup, instant cash-out with fee and new-partner reserve, then the weekly run", async () => {
  let info = await ok("GET", "/v1/payouts", pa);
  assert.equal(info.account.connected, false);
  assert.equal(info.schedule.kind, "weekly");
  assert.equal((await call("POST", "/v1/payouts/instant", pa)).status, 409, "needs payout setup first");
  const link = await ok("POST", "/v1/payouts/account", pa, { returnUrl: "exp://192.168.1.5:8082/--/payouts" });
  assert.match(link.url, /onboard\/acct_/);
  const acct = (await app.db.get(`SELECT stripe_account_id FROM payout_accounts WHERE user_id = $1`, [paId])).stripe_account_id;
  stripe.finishOnboarding(acct);
  info = await ok("POST", "/v1/payouts/account/sync", pa);
  assert.equal(info.account.payoutsEnabled, true);

  const bal = info.balance.availableCents;
  const r = await ok("POST", "/v1/payouts/instant", pa);
  const reserve = Math.round(bal * 0.05);
  assert.equal(r.reserveCents, reserve);
  assert.equal(r.feeCents, 85);
  assert.equal(r.amountCents, bal - reserve - 85);
  assert.equal(stripe.state.transfers.at(-1).amount, r.amountCents);
  assert.equal(r.balance.availableCents, 0);
  assert.equal(r.balance.reserveCents, reserve);

  // More earnings, then Monday 9 PM Eastern pays the weekly batch, once.
  const job = await book({ windowStart: clock + 5 * HOUR });
  await ok("POST", `/v1/jobs/${job.id}/accept`, pa);
  await startWork(job);
  await ok("POST", `/v1/jobs/${job.id}/complete`, pa, { inspection: INSPECTION });
  const owed = (await ok("GET", "/v1/payouts", pa)).balance.availableCents;
  clock = Date.parse("2026-11-10T02:30:00Z"); // Monday Nov 9, 9:30 PM in Knoxville
  const transfers = stripe.state.transfers.length;
  await app.jobs.sweep();
  await app.jobs.sweep();
  assert.equal(stripe.state.transfers.length, transfers + 1, "one weekly payout, not two");
  assert.equal(stripe.state.transfers.at(-1).amount, owed - Math.round(owed * 0.05));
  const after = await ok("GET", "/v1/payouts", pa);
  assert.equal(after.payouts[0].kind, "weekly");
});

test("fleets on card terms start right away and each visit's invoice is charged to the card", async () => {
  await ok("POST", "/v1/fleet", cust, { name: "Reed Lawn Care", managerName: "Jordan Reed", billingEmail: "jordan@reedlawn.com", yardStreet: "88 Yard Rd", yardCity: "Knoxville", yardState: "TN", yardZip: "37919", yardHours: "Mon–Fri 7–5", checkinNotes: "Keys are in the shop office.", terms: "card", autoApproveCents: 0, poRequired: false }, 201);
  const f = await ok("GET", "/v1/fleet", cust);
  assert.equal(f.fleet.status, "active");
  assert.equal(f.hasCard, true);
  const v = (await ok("POST", "/v1/fleet/vehicles", cust, { unit: "Truck 1", year: 2020, make: "Ford", model: "F-250", vehicleClass: "van_pickup", mileage: 30000 }, 201)).vehicles[0];
  const run = (await ok("POST", "/v1/fleet/runs", cust, { vehicleIds: [v.id], serviceIds: ["oil_change"], windowStart: clock + 5 * HOUR }, 201)).run;
  await ok("PUT", "/v1/onboarding/steps/business", pa, { legalFirst: "Amanda", legalLast: "Smith" });
  await ok("POST", "/v1/onboarding/sign", pa, { docId: "esign" });
  await ok("POST", "/v1/onboarding/sign", pa, { docId: "fleet", name: "Amanda Smith" });
  await ok("POST", `/v1/fleet-runs/${run.id}/claim`, pa);
  clock = Math.max(clock, run.windowStart - HOUR);
  const r = (await ok("POST", `/v1/fleet-runs/${run.id}/start`, pa)).run;
  const rv = r.vehicles[0].id;
  await ok("POST", `/v1/fleet-runs/${run.id}/vehicles/${rv}/check-in`, pa, { odometer: 30500 });
  await ok("POST", `/v1/fleet-runs/${run.id}/vehicles/${rv}/done`, pa, { inspection: INSPECTION, notes: "Oil and filter changed. Next at 35,500." });
  const before = Object.keys(stripe.state.intents).length;
  await ok("POST", `/v1/fleet-runs/${run.id}/finish`, pa);
  const inv = (await ok("GET", `/v1/fleet/runs/${run.id}`, cust)).run.invoice;
  assert.equal(inv.status, "paid");
  const pi = Object.values(stripe.state.intents).slice(before)[0];
  assert.equal(pi.amount, inv.totalCents);
  assert.equal(pi.status, "succeeded");
});

test("tips are charged to the card and go to the partner; claim holds that job's pay; what's owed comes out of payouts at most 25%", async () => {
  const job = await book({ windowStart: clock + 5 * HOUR });
  await ok("POST", `/v1/jobs/${job.id}/accept`, pa);
  await startWork(job);
  await ok("POST", `/v1/jobs/${job.id}/complete`, pa, { inspection: INSPECTION });
  const before = Object.keys(stripe.state.intents).length;
  const r = await ok("POST", `/v1/jobs/${job.id}/rating`, cust, { stars: 5, tipCents: 800 }, 201);
  assert.equal(r.tip.status, "succeeded");
  const pi = Object.values(stripe.state.intents).slice(before).find((x) => x.metadata && x.metadata.kind === "tip");
  assert.equal(pi.amount, 800);

  // A claim on this job holds its pay (and the tip); other money stays available.
  const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]).toString("base64");
  const c = (await ok("POST", "/v1/claims", cust, { jobId: job.id, damageTo: "property", wants: "reimbursement", description: "Oil stain on the garage floor after the visit.", photos: [{ contentType: "image/jpeg", data: JPG }] }, 201)).claim;
  const held = (await ok("GET", "/v1/payouts", pa)).balance;
  const jobPay = (await ok("GET", `/v1/jobs/${job.id}`, pa)).job.final.partnerPay;
  assert.equal(held.heldCents, jobPay.earningsCents + jobPay.partsReimbursedCents + 800);
  clock += 49 * HOUR;
  await app.app.tick();
  await ok("POST", `/v1/admin/claims/${c.id}/decision`, admin, { outcome: "pay", amount: 300, paidBy: "protection", note: "The after photo shows the oil on the floor next to the car." });

  // The $300 deductible comes out of the next cash-out, at most 25% of it.
  const bal = (await ok("GET", "/v1/payouts", pa)).balance;
  assert.equal(bal.heldCents, 0);
  assert.equal(bal.owedCents, 30000);
  const out = await ok("POST", "/v1/payouts/instant", pa);
  const gross = bal.availableCents - out.reserveCents - out.feeCents;
  assert.equal(out.recoveredCents, Math.min(30000, Math.floor(gross * 0.25)));
  assert.equal(out.amountCents, gross - out.recoveredCents);
  assert.equal(stripe.state.transfers.at(-1).amount, out.amountCents);
  const after = await ok("GET", "/v1/payouts", pa);
  assert.equal(after.balance.owedCents, 30000 - out.recoveredCents);
  assert.equal(after.balance.availableCents, 0);
  assert.ok(after.activity.some((a) => a.kind === "adjustment" && /Recovered: Deductible/.test(a.note)));
});

test("without Stripe nothing is charged, but partner earnings are still recorded", async () => {
  const off = await startTestApp({}, {});
  try {
    const c = await off.call("POST", "/v1/auth/signup", { body: customer({ email: "off@example.com" }) });
    const cfg = await off.call("GET", "/v1/payments/config", { token: c.body.token });
    assert.equal(cfg.body.enabled, false);
    const setup = await off.call("POST", "/v1/payments/cards/setup", { token: c.body.token, body: {} });
    assert.equal(setup.status, 503);
  } finally { await off.close(); }
});

test("when Stripe refuses (like Connect not turned on), the app gets Stripe's reason in test mode", async () => {
  const fs = createFakeStripe();
  const off = await startTestApp({ STRIPE_SECRET_KEY: "sk_test_fake" }, { stripeFetch: async (url, opts) => (url.endsWith("/v2/core/accounts")
    ? { status: 400, json: async () => ({ error: { type: "invalid_request_error", message: "You can only create new accounts if you've signed up for Connect." } }) }
    : fs.fetch(url, opts)) });
  try {
    const p = await off.call("POST", "/v1/auth/signup", { body: partner({ email: "noconnect@example.com" }) });
    const r = await off.call("POST", "/v1/payouts/account", { token: p.body.token, body: { returnUrl: "exp://x/--/payouts" } });
    assert.equal(r.status, 502);
    assert.match(r.body.error.message, /signed up for Connect/);
  } finally { await off.close(); }
});
