// Step 13: notifications (inbox, push, text, email), ratings and tips, damage claims, and warranty returns.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startTestApp, customer, partner } from "./helpers.js";

const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;
let clock = Date.parse("2026-11-02T13:00:00Z");
let app, cust, custId, pa, paId, pb, pbId, admin, vehicleId, placeId;
const sent = { push: [], sms: [], email: [] };
let pushReply = null;
let smsReply = null;

// Stand-ins for Expo push, Twilio, and Resend. They record what would have gone out.
async function fakeNotify(url, opts) {
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  if (url.includes("/--/api/v2/push/send")) {
    const msgs = JSON.parse(opts.body);
    sent.push.push(...msgs);
    return json(200, { data: msgs.map((m) => (pushReply ? pushReply(m) : { status: "ok", id: "tkt" })) });
  }
  if (url.includes("/Messages.json")) {
    const form = new URLSearchParams(opts.body);
    sent.sms.push({ to: form.get("To"), body: form.get("Body"), from: form.get("From"), auth: opts.headers.Authorization });
    return smsReply ? smsReply() : json(201, { sid: "SM1" });
  }
  if (url.endsWith("/emails")) {
    sent.email.push({ ...JSON.parse(opts.body), auth: opts.headers.Authorization });
    return json(200, { id: "em_1" });
  }
  return json(404, {});
}

const call = (m, p, token, body) => app.call(m, p, { token, body });
const ok = async (m, p, token, body, status = 200) => {
  const r = await call(m, p, token, body);
  assert.equal(r.status, status, `${m} ${p} → ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
};
const INSPECTION = Object.fromEntries(["brakes", "tires", "fluids", "battery", "wipers", "lights", "belts_hoses", "filters"].map((k) => [k, { status: "good" }]));
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]).toString("base64");
const photo = { contentType: "image/jpeg", data: JPG };

// Books, accepts, and completes a job with the given partner.
async function doneJob(token = pa, over = {}) {
  const job = (await ok("POST", "/v1/jobs", cust, { vehicleId, placeId, serviceIds: ["oil_change"], kind: "scheduled", windowStart: clock + 3 * HOUR, ...over }, 201)).job;
  await ok("POST", `/v1/jobs/${job.id}/accept`, token);
  await finish(job, token);
  return job;
}
async function finish(job, token) {
  clock = Math.max(clock, job.windowStart - HOUR);
  await ok("POST", `/v1/jobs/${job.id}/start-trip`, token);
  await ok("POST", `/v1/jobs/${job.id}/arrive`, token);
  await ok("POST", `/v1/jobs/${job.id}/check-in`, token, { odometer: 85000 });
  await ok("POST", `/v1/jobs/${job.id}/complete`, token, { inspection: INSPECTION });
}

before(async () => {
  app = await startTestApp({ TWILIO_ACCOUNT_SID: "AC123", TWILIO_AUTH_TOKEN: "secret", TWILIO_FROM_NUMBER: "+18655550000", RESEND_API_KEY: "re_test", EMAIL_FROM: "Auto-Auto <hi@autoauto.test>" },
    { now: () => clock, notifyFetch: fakeNotify });
  const c = await call("POST", "/v1/auth/signup", null, customer({ email: "care-c@example.com", phone: "(865) 555-0101" }));
  cust = c.body.token; custId = c.body.user.id;
  const a = await call("POST", "/v1/auth/signup", null, partner({ email: "care-a@example.com", firstName: "Amanda", lastName: "Smith" }));
  pa = a.body.token; paId = a.body.user.id;
  const b = await call("POST", "/v1/auth/signup", null, partner({ email: "care-b@example.com", firstName: "Ben", lastName: "Cole" }));
  pb = b.body.token; pbId = b.body.user.id;
  const ad = await call("POST", "/v1/auth/signup", null, customer({ email: "care-ops@example.com" }));
  await app.db.run(`UPDATE users SET role = 'admin' WHERE id = $1`, [ad.body.user.id]);
  admin = ad.body.token;
  for (const [t, id] of [[pa, paId], [pb, pbId]]) {
    await ok("POST", `/v1/admin/partners/${id}/status`, admin, { status: "active" });
    await ok("PUT", "/v1/partner/services", t, { serviceIds: ["oil_change", "brakes"] });
  }
  vehicleId = (await ok("POST", "/v1/vehicles", cust, { year: 2015, make: "Honda", model: "Civic", mileage: 84000 }, 201)).vehicle.id;
  placeId = (await ok("POST", "/v1/places", cust, { label: "Home", street: "123 Kingston Pike", city: "Knoxville", state: "TN", zip: "37919" }, 201)).place.id;
});
after(async () => { await app.close(); });

test("notification settings: sensible defaults, texts need consent and a mobile number", async () => {
  const s = await ok("GET", "/v1/notifications/settings", cust);
  assert.deepEqual(s.categories.map((c) => c.id), ["booking", "on_the_way", "addons", "messages", "receipts", "claims"]);
  assert.deepEqual(s.categories.find((c) => c.id === "receipts"), { id: "receipts", label: "Receipts & charges", push: true, sms: false, email: true });
  assert.equal(s.sms.optedIn, false);
  assert.equal(s.sms.connected, true);
  assert.equal(s.email.connected, true);
  const p = await ok("GET", "/v1/notifications/settings", pa);
  assert.ok(p.categories.some((c) => c.id === "offers" && c.sms));

  const other = (await call("POST", "/v1/auth/signup", null, customer({ email: "nophone@example.com" }))).body.token;
  const noPhone = await call("PUT", "/v1/notifications/settings", other, { smsOptIn: true });
  assert.equal(noPhone.status, 422);
  assert.match(noPhone.body.error.fields.smsOptIn, /mobile number/);

  const saved = await ok("PUT", "/v1/notifications/settings", cust, { smsOptIn: true, categories: { booking: { email: true }, messages: { push: false } } });
  assert.equal(saved.sms.optedIn, true);
  assert.deepEqual(saved.categories.find((c) => c.id === "booking"), { id: "booking", label: "Booking updates", push: true, sms: true, email: true });
  assert.equal(saved.categories.find((c) => c.id === "messages").push, false);
  assert.equal((await call("PUT", "/v1/notifications/settings", cust, { categories: { booking: { push: "yes" } } })).status, 422);

  assert.equal((await call("POST", "/v1/push-tokens", cust, { token: "not-a-token" })).status, 422);
  await ok("POST", "/v1/push-tokens", cust, { token: "ExponentPushToken[cust-phone-0001]", platform: "ios" });
  await ok("POST", "/v1/push-tokens", pa, { token: "ExponentPushToken[partner-phone-01]", platform: "android" });
  assert.equal((await ok("GET", "/v1/notifications/settings", cust)).push.devices, 1);
});

test("a visit sends updates to the inbox, phone, text, and email, as each person chose", async () => {
  sent.push.length = 0; sent.sms.length = 0; sent.email.length = 0;
  const job = (await ok("POST", "/v1/jobs", cust, { vehicleId, placeId, serviceIds: ["oil_change"], kind: "scheduled", windowStart: clock + 3 * HOUR }, 201)).job;
  await ok("POST", `/v1/jobs/${job.id}/accept`, pa);
  await finish(job, pa);
  await ok("POST", `/v1/jobs/${job.id}/messages`, pa, { body: "All done! Call me at 865-555-0199" }, 201);
  await app.app.notify.flush();

  const inbox = await ok("GET", "/v1/notifications", cust);
  const titles = inbox.notifications.map((n) => n.title);
  for (const want of ["Your visit is confirmed", "Amanda is on the way", "Amanda has arrived", "Your visit is done", "Message from Amanda"]) assert.ok(titles.includes(want), `missing "${want}" in ${titles}`);
  assert.equal(inbox.unread, inbox.notifications.length);
  const msg = inbox.notifications.find((n) => n.title === "Message from Amanda");
  assert.match(msg.body, /number hidden/, "phone numbers stay hidden");
  assert.deepEqual(msg.data, { route: "/chat", params: { id: job.id } });

  // Push: everything but messages (turned off). Texts: booking and on-the-way. Email: booking and the receipt.
  assert.ok(sent.push.every((m) => m.to === "ExponentPushToken[cust-phone-0001]" || m.to === "ExponentPushToken[partner-phone-01]"));
  assert.ok(!sent.push.some((m) => m.title === "Message from Amanda"));
  assert.ok(sent.push.some((m) => m.title === "Amanda is on the way" && m.data.route === "/job"));
  const texts = sent.sms.map((s) => s.body);
  assert.ok(texts.some((x) => x.startsWith("Auto-Auto: Your visit is confirmed.")));
  assert.ok(texts[0].endsWith("Reply STOP to stop texts."), "the first text says how to stop");
  assert.ok(!texts[1].includes("Reply STOP"));
  assert.ok(sent.sms.every((s) => s.to === "+18655550101" && s.from === "+18655550000"));
  assert.equal(sent.sms[0].auth, `Basic ${Buffer.from("AC123:secret").toString("base64")}`);
  const receipt = sent.email.find((e) => e.subject === "Your visit is done");
  assert.ok(receipt);
  assert.deepEqual(receipt.to, ["care-c@example.com"]);
  assert.equal(receipt.from, "Auto-Auto <hi@autoauto.test>");
  assert.match(receipt.text, /Oil change: \$80/);
  assert.match(receipt.text, /under warranty until/);
  assert.equal(receipt.auth, "Bearer re_test");

  const read = await ok("POST", "/v1/notifications/read", cust, { ids: [msg.id] });
  assert.equal(read.unread, inbox.unread - 1);
  assert.equal((await ok("POST", "/v1/notifications/read", cust, {})).unread, 0);
  const pin = await ok("GET", "/v1/notifications", pa);
  assert.ok(pin.notifications.length === 0 || pin.notifications.every((n) => n.category));
});

test("a phone that's gone stops getting alerts; replying STOP turns texts off", async () => {
  pushReply = () => ({ status: "error", message: "gone", details: { error: "DeviceNotRegistered" } });
  smsReply = () => new Response(JSON.stringify({ code: 21610, message: "Attempt to send to unsubscribed recipient" }), { status: 400 });
  const job = (await ok("POST", "/v1/jobs", cust, { vehicleId, placeId, serviceIds: ["oil_change"], kind: "scheduled", windowStart: clock + 3 * HOUR }, 201)).job;
  await ok("POST", `/v1/jobs/${job.id}/accept`, pa);
  await app.app.notify.flush();
  pushReply = null; smsReply = null;
  const s = await ok("GET", "/v1/notifications/settings", cust);
  assert.equal(s.push.devices, 0);
  assert.equal(s.sms.optedIn, false);
  const status = await ok("GET", "/v1/admin/notifications", admin);
  assert.deepEqual(status.providers, { push: "Expo", sms: "Twilio", email: "Resend" });
  assert.ok(status.failures.some((f) => f.channel === "sms" && /21610/.test(f.error)));
  await ok("POST", `/v1/jobs/${job.id}/cancel`, cust, {});
});

test("ratings and tips: once per visit, tips go to the partner, reviews show on their profile", async () => {
  const job = await doneJob();
  const bad = async (body, field) => {
    const r = await call("POST", `/v1/jobs/${job.id}/rating`, cust, body);
    assert.equal(r.status, 422, JSON.stringify(r.body));
    assert.ok(r.body.error.fields[field], field);
  };
  await bad({ stars: 0 }, "stars");
  await bad({ stars: 5, tags: ["Amazing"] }, "tags");
  await bad({ stars: 5, tipCents: 1_000_000 }, "tipCents");
  const r = await ok("POST", `/v1/jobs/${job.id}/rating`, cust, {
    stars: 5, tags: ["On time", "Explained the work"], serviceStars: { oil_change: 5 }, review: "Showed me the old filter. Text me at 865-555-0101!",
    privateNote: "Great experience", tipCents: 1200, favorite: true,
  }, 201);
  assert.equal(r.rating.stars, 5);
  assert.match(r.rating.review, /number hidden/);
  assert.deepEqual(r.tip, { status: "recorded", amountCents: 1200, message: null });
  assert.equal((await call("POST", `/v1/jobs/${job.id}/rating`, cust, { stars: 4 })).status, 409, "only once");
  assert.equal((await call("POST", `/v1/jobs/${job.id}/tip`, cust, { tipCents: 500 })).status, 409, "only one tip");

  const v = (await ok("GET", `/v1/jobs/${job.id}`, cust)).job;
  assert.equal(v.care.rating.stars, 5);
  assert.deepEqual(v.care.tip, { amountCents: 1200, status: "recorded" });
  assert.equal(v.care.canRate, false);
  assert.equal(v.partner.rating.average, 5);

  const reviews = await ok("GET", "/v1/partner/reviews", pa);
  assert.equal(reviews.average, 5);
  assert.equal(reviews.reviews[0].name, "Jordan R.");
  assert.equal(reviews.reviews[0].review.includes("865"), false);
  assert.equal(JSON.stringify(reviews).includes("Great experience"), false, "private notes stay private");
  assert.equal(reviews.tipsLast30DaysCents, 1200);
  assert.deepEqual(reviews.mentions.map((m) => m.tag).sort(), ["Explained the work", "On time"]);
  const pj = (await ok("GET", `/v1/jobs/${job.id}`, pa)).job;
  assert.equal(pj.tipCents, 1200);
  const ledger = await app.db.get(`SELECT * FROM partner_ledger WHERE job_id = $1 AND note LIKE 'Tip%'`, [job.id]);
  assert.equal(ledger.cents, 1200);
  assert.ok((await ok("GET", "/v1/notifications", pa)).notifications.some((n) => n.title === "New 5-star rating and a $12 tip"));

  // The partner rates the customer privately, once.
  await ok("POST", `/v1/jobs/${job.id}/rate-customer`, pa, { stars: 5 });
  assert.equal((await call("POST", `/v1/jobs/${job.id}/rate-customer`, pa, { stars: 4 })).status, 409);
  assert.equal(JSON.stringify((await ok("GET", `/v1/jobs/${job.id}`, cust)).job).includes("customerRated"), false);

  // Favorites get the customer's instant jobs first, even when another partner is just as close.
  const fav = await app.db.get(`SELECT * FROM favorite_partners WHERE customer_id = $1`, [custId]);
  assert.equal(fav.partner_id, paId);

  // Tips close after 24 hours; ratings after 14 days.
  const late = await doneJob();
  clock += 25 * HOUR;
  assert.equal((await call("POST", `/v1/jobs/${late.id}/tip`, cust, { tipCents: 500 })).status, 409);
  assert.equal((await call("POST", `/v1/jobs/${late.id}/rating`, cust, { stars: 4, tipCents: 500 })).status, 422);
  await ok("POST", `/v1/jobs/${late.id}/rating`, cust, { stars: 2, tags: ["Arrived late"] }, 201);
  const low = await ok("GET", "/v1/admin/ratings", admin);
  assert.equal(low.ratings[0].stars, 2);
  assert.equal(low.ratings[0].followedUp, false);
  await ok("POST", `/v1/admin/ratings/${low.ratings[0].id}/follow-up`, admin);
  assert.equal((await ok("GET", "/v1/admin/ratings", admin)).ratings[0].followedUp, true);
  assert.equal((await ok("GET", "/v1/admin/overview", admin)).lowRatings, 0);
});

test("damage claims: photos required, partner responds, staff decide, the deductible is owed", async () => {
  const job = await doneJob();
  const bad = async (body, field) => {
    const r = await call("POST", "/v1/claims", cust, { jobId: job.id, damageTo: "vehicle", wants: "repair", description: "Scratch on the driver door that wasn't there before.", photos: [photo], ...body });
    assert.equal(r.status, 422, JSON.stringify(r.body));
    assert.ok(r.body.error.fields[field], field);
  };
  await bad({ photos: [] }, "photos");
  await bad({ description: "scratch" }, "description");
  await bad({ damageTo: "moon" }, "damageTo");
  await bad({ estimate: "lots" }, "estimate");
  const list0 = await ok("GET", "/v1/claims", cust);
  assert.ok(list0.jobs.some((j) => j.id === job.id && j.partner === "Amanda S."));

  const c = (await ok("POST", "/v1/claims", cust, { jobId: job.id, damageTo: "vehicle", wants: "repair", estimate: "420", description: "Scratch on the driver door that wasn't there before.", photos: [photo, photo] }, 201)).claim;
  assert.match(c.number, /^CLM-10\d\d$/);
  assert.equal(c.status, "partner");
  assert.equal(c.step, 1);
  assert.equal(c.photos.length, 2);
  assert.equal(c.estimateCents, 42000);
  assert.equal((await call("POST", "/v1/claims", cust, { jobId: job.id, damageTo: "vehicle", wants: "repair", description: "Another scratch on the same door.", photos: [photo] })).status, 409, "one open claim per visit");

  // The partner sees it, with their check-in photos, and this job's pay is held.
  const pc = await ok("GET", "/v1/claims", pa);
  assert.equal(pc.claims[0].id, c.id);
  assert.equal(pc.claims[0].customer, "Jordan R.");
  assert.ok((await ok("GET", "/v1/notifications", pa)).notifications.some((n) => n.title === `Damage claim ${c.number}`));
  const pay = await ok("GET", "/v1/payouts", pa);
  assert.ok(pay.balance.heldCents >= 4700, `held ${pay.balance.heldCents}`);

  assert.equal((await call("POST", `/v1/admin/claims/${c.id}/decision`, admin, { outcome: "deny", note: "Waiting is over, deciding now anyway." })).status, 409, "partner gets their 48 hours");
  assert.equal((await call("POST", `/v1/claims/${c.id}/respond`, pa, { response: "Not me" })).status, 422);
  const responded = (await ok("POST", `/v1/claims/${c.id}/respond`, pa, { response: "The scratch is in my check-in photo of the left side. I noted it before starting." })).claim;
  assert.equal(responded.status, "review");
  assert.equal((await call("POST", `/v1/claims/${c.id}/respond`, pa, { response: "One more thing to add to my response here." })).status, 409);
  assert.equal((await ok("GET", `/v1/claims/${c.id}`, cust)).claim.partnerResponse, undefined, "the customer sees progress, not the partner's statement");

  const staff = (await ok("GET", `/v1/admin/claims/${c.id}`, admin)).claim;
  assert.equal(staff.coverage, "protection");
  assert.deepEqual(staff.paidByOptions, ["protection"]);
  assert.match(staff.partnerResponse, /check-in photo/);
  assert.equal((await ok("GET", "/v1/admin/overview", admin)).claimsReady, 1);
  assert.equal((await call("POST", `/v1/admin/claims/${c.id}/decision`, admin, { outcome: "pay", amount: 420, paidBy: "own_insurer", note: "Partner at fault based on the after photos." })).status, 422);
  assert.equal((await call("POST", `/v1/admin/claims/${c.id}/decision`, admin, { outcome: "pay", amount: 420, paidBy: "protection", note: "short" })).status, 422);
  const d = (await ok("POST", `/v1/admin/claims/${c.id}/decision`, admin, { outcome: "pay", amount: 420, paidBy: "protection", note: "The after photos show a new scratch the check-in photos don't." })).claim;
  assert.equal(d.status, "closed");
  assert.equal(d.debts[0].cents, 42000 > 50000 ? 50000 : 42000, "deductible is $500 or the claim amount, whichever is less");
  const after = await ok("GET", "/v1/payouts", pa);
  assert.equal(after.balance.heldCents, 0, "pay is released once decided");
  assert.equal(after.owed[0].owedCents, 42000);
  assert.equal(after.balance.owedCents, 42000);
  const cv = (await ok("GET", `/v1/claims/${c.id}`, cust)).claim;
  assert.equal(cv.step, 4);
  assert.equal(cv.decision.outcomeLabel, "Approved");
  assert.ok((await ok("GET", "/v1/notifications", cust)).notifications.some((n) => n.title === `Claim ${c.number} decided`));

  // Staff can waive what's owed.
  const debts = await ok("GET", "/v1/admin/debts", admin);
  await ok("POST", `/v1/admin/debts/${debts.debts[0].id}/waive`, admin, { waive: true });
  assert.equal((await ok("GET", "/v1/payouts", pa)).balance.owedCents, 0);

  // A goodwill credit comes off the customer's next visit.
  const job2 = await doneJob();
  const c2 = (await ok("POST", "/v1/claims", cust, { jobId: job2.id, damageTo: "property", wants: "not_sure", description: "Oil drip on the driveway after the visit.", photos: [photo] }, 201)).claim;
  clock += 49 * HOUR;
  await app.app.tick();
  assert.equal((await ok("GET", `/v1/admin/claims/${c2.id}`, admin)).claim.status, "review", "no answer in 48 hours: ready to decide");
  await ok("POST", `/v1/admin/claims/${c2.id}/decision`, admin, { outcome: "goodwill", amount: "25", note: "Can't prove the drip was from the visit, so here's a credit." });
  const credit = await app.db.get(`SELECT * FROM customer_credits WHERE user_id = $1 AND reason LIKE 'Goodwill%'`, [custId]);
  assert.equal(credit.cents, 2500);
});

test("warranty returns: free, offered to the original partner first, charged back if someone else does it", async () => {
  const job = await doneJob();
  const bad = async (body, field, status = 422) => {
    const r = await call("POST", `/v1/jobs/${job.id}/warranty`, cust, { issue: "same_problem", windowStart: clock + DAY, ...body });
    assert.equal(r.status, status, JSON.stringify(r.body));
    if (field) assert.ok(r.body.error.fields[field], field);
  };
  await bad({ issue: "bored" }, "issue");
  await bad({ windowStart: clock + HOUR }, "windowStart");

  // The original partner takes it: no charge, no pay.
  let w = (await ok("POST", `/v1/jobs/${job.id}/warranty`, cust, { issue: "same_problem", details: "Oil light flickers again.", windowStart: clock + DAY, photos: [photo] }, 201)).job;
  assert.equal(w.quote.totalCents, 0);
  assert.equal(w.quote.payLines, undefined);
  assert.equal(w.warrantyReturn.withOriginalPartner, true);
  assert.equal(w.warrantyReturn.photos.length, 1);
  await bad({}, null, 409);
  assert.ok(!(await ok("GET", "/v1/jobs/board", pb)).jobs.some((j) => j.id === w.id), "only the original partner sees it at first");
  assert.equal((await call("POST", `/v1/jobs/${w.id}/accept`, pb)).status, 409);
  const mine = (await ok("GET", "/v1/jobs/board", pa)).jobs.find((j) => j.id === w.id);
  assert.equal(mine.warranty.original, true);
  assert.equal(mine.pay.earningsCents, 0);
  assert.ok((await ok("GET", "/v1/notifications", pa)).notifications.some((n) => n.title === "Warranty return request"));
  await ok("POST", `/v1/jobs/${w.id}/accept`, pa);
  const r = await call("POST", `/v1/jobs/${w.id}/addons`, pa, { serviceIds: ["brakes"], reason: "Pads are low" });
  assert.equal(r.status, 409, "not before check-in");
  await finish(w, pa);
  w = (await ok("GET", `/v1/jobs/${w.id}`, cust)).job;
  assert.equal(w.final.chargeCents, 0);
  assert.equal((await ok("GET", `/v1/jobs/${w.id}`, pa)).job.final.partnerPay.earningsCents, 0);
  assert.equal(w.warrantyUntil, (await ok("GET", `/v1/jobs/${job.id}`, cust)).job.warrantyUntil, "the warranty doesn't restart");

  // The original partner can't make it: it goes to everyone, and the cost is charged back.
  const w2 = (await ok("POST", `/v1/jobs/${job.id}/warranty`, cust, { issue: "warning_light", windowStart: clock + 2 * DAY }, 201)).job;
  await ok("POST", `/v1/jobs/${w2.id}/decline-warranty`, pa);
  assert.ok(!(await ok("GET", "/v1/jobs/board", pa)).jobs.some((j) => j.id === w2.id));
  const other = (await ok("GET", "/v1/jobs/board", pb)).jobs.find((j) => j.id === w2.id);
  assert.ok(other, "now other partners see it");
  assert.equal(other.pay.earningsCents, 4700, "a new partner is paid the usual amount");
  await ok("POST", `/v1/jobs/${w2.id}/accept`, pb);
  await finish(w2, pb);
  const debt = await app.db.get(`SELECT * FROM partner_debts WHERE partner_id = $1 AND job_id = $2`, [paId, w2.id]);
  assert.ok(debt.cents >= 4700, `charge-back ${debt.cents}`);
  const list = await ok("GET", "/v1/admin/warranty", admin);
  const row = list.returns.find((x) => x.returnJobId === w2.id);
  assert.equal(row.samePartner, false);
  assert.equal(row.chargeBack, true);
  await ok("POST", `/v1/admin/warranty/${row.id}/charge-back`, admin, { chargeBack: false });
  assert.ok((await app.db.get(`SELECT waived_at FROM partner_debts WHERE id = $1`, [debt.id])).waived_at);

  // No answer within 24 hours: it goes out to everyone.
  const w3 = (await ok("POST", `/v1/jobs/${job.id}/warranty`, cust, { issue: "loose_missing", windowStart: clock + 3 * DAY }, 201)).job;
  clock += 25 * HOUR;
  await app.jobs.sweep();
  assert.ok((await ok("GET", "/v1/jobs/board", pb)).jobs.some((j) => j.id === w3.id));
  assert.ok((await ok("GET", "/v1/notifications", cust)).notifications.some((n) => n.title === "Another partner will handle your warranty return"));
  await ok("POST", `/v1/jobs/${w3.id}/cancel`, cust, {});

  // After the warranty ends, it's a new visit.
  clock += 400 * DAY;
  await bad({ windowStart: clock + DAY }, null, 409);
});

test("insurance reminders go out once at 30, 14, and 3 days", async () => {
  await app.db.run(`INSERT INTO partner_applications (user_id, answers, created_at, updated_at) VALUES ($1, $2, $3, $3) ON CONFLICT (user_id) DO UPDATE SET answers = excluded.answers`,
    [pbId, JSON.stringify({ insurance: { coverage: "aa", autoCarrier: "Progressive", autoPolicy: "P-1", autoExpires: new Date(clock + 10 * DAY).toISOString().slice(0, 10) } }), clock]).catch(async () => {
    await app.db.run(`UPDATE partner_applications SET answers = $1 WHERE user_id = $2`, [JSON.stringify({ insurance: { coverage: "aa", autoExpires: new Date(clock + 10 * DAY).toISOString().slice(0, 10) } }), pbId]);
  });
  await app.app.admin.reminders();
  clock += 11 * 60_000;
  await app.app.admin.reminders();
  const n = (await ok("GET", "/v1/notifications", pb)).notifications.filter((x) => /Vehicle insurance expires/.test(x.title));
  assert.equal(n.length, 1, "once, not every 10 minutes");
  assert.match(n[0].title, /expires in (9|10) days/);
});
