import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startTestApp, customer, partner } from "./helpers.js";
import { createFakeStripe } from "./fake-stripe.js";

const DAY = 86_400_000;
let clock = Date.parse("2026-11-02T13:00:00Z");
let app, stripe, admin, pa, paId, pb, pbId;

const call = (m, p, token, body) => app.call(m, p, { token, body });
const ok = async (m, p, token, body, status = 200) => {
  const r = await call(m, p, token, body);
  assert.equal(r.status, status, `${m} ${p} → ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
};
const step = (s, id) => s.steps.find((x) => x.id === id);
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n").toString("base64");
const upload = (token, kind) => ok("POST", "/v1/onboarding/files", token, { kind, filename: `${kind}.pdf`, contentType: "application/pdf", data: PDF }, 201);

// Fills in every step for a partner, the way the app would.
async function complete(token, { first = "Amanda", last = "Smith", sign = `${first} ${last}`, autoExpires = "2029-06-01" } = {}) {
  await ok("PUT", "/v1/partner/service-area", token, { street: "45 Main St", city: "Knoxville", state: "TN", zip: "37919", radiusMiles: 25 });
  await ok("PUT", "/v1/partner/services", token, { serviceIds: ["oil_change", "tire_rotation"] });
  await ok("PUT", "/v1/onboarding/steps/business", token, { legalFirst: first, legalLast: last, entity: "individual", street: "1 Oak St", city: "Knoxville", state: "TN", zip: "37919", employees: "0" });
  await ok("POST", "/v1/onboarding/sign", token, { docId: "esign" });
  await ok("POST", "/v1/onboarding/sign", token, { docId: "w9", name: sign });
  await ok("PUT", "/v1/onboarding/steps/identity", token, { dlState: "TN", dlExpires: "2029-03-01", yearsLicensed: "5" });
  const { url } = await ok("POST", "/v1/onboarding/identity", token, { returnUrl: "exp://192.168.1.5:8082/--/onboarding/identity" });
  if (url) {
    stripe.finishIdentity(url.split("/").pop());
    await ok("POST", "/v1/onboarding/identity/sync", token);
  }
  await ok("POST", "/v1/onboarding/sign", token, { docId: "bg_disclosure" });
  await ok("POST", "/v1/onboarding/sign", token, { docId: "bg_auth", name: sign });
  await ok("PUT", "/v1/onboarding/steps/insurance", token, { coverage: "aa", ppTerms: true, autoType: "bizuse", autoBizUse: true, autoCarrier: "State Farm", autoPolicy: "SF-1", autoExpires, wcAck: true });
  await upload(token, "auto");
  await ok("PUT", "/v1/onboarding/steps/skills", token, { experience: "5", setting: "mobile" });
  await ok("PUT", "/v1/onboarding/steps/safety", token, { lift: true, spill: true, fire: true, usedOil: true, filters: true, noStreet: true, sober: true, usedOilSite: "AutoZone, Kingston Pike" });
  const link = await ok("POST", "/v1/payouts/account", token, { returnUrl: "exp://192.168.1.5:8082/--/payouts" });
  stripe.finishOnboarding(link.url.match(/acct_\d+/)[0]);
  await ok("POST", "/v1/payouts/account/sync", token);
  await ok("PUT", "/v1/onboarding/steps/payouts", token, { tax1099: true, tips: true });
  let s;
  for (const id of ["ica", "liab", "pay", "privacy", "safety", "arb"]) s = await ok("POST", "/v1/onboarding/sign", token, { docId: id, name: sign });
  return s;
}

before(async () => {
  stripe = createFakeStripe();
  app = await startTestApp({ STRIPE_SECRET_KEY: "sk_test_fake" }, { now: () => clock, stripeFetch: stripe.fetch });
  const a = await call("POST", "/v1/auth/signup", null, partner({ email: "onb-a@example.com" }));
  pa = a.body.token; paId = a.body.user.id;
  const b = await call("POST", "/v1/auth/signup", null, partner({ email: "onb-b@example.com", firstName: "Ben", lastName: "Cole" }));
  pb = b.body.token; pbId = b.body.user.id;
  const ad = await call("POST", "/v1/auth/signup", null, customer({ email: "onb-ops@example.com" }));
  await app.db.run(`UPDATE users SET role = 'admin' WHERE id = $1`, [ad.body.user.id]);
  admin = ad.body.token;
});
after(async () => { await app.close(); });

test("a new partner sees every step with what's missing", async () => {
  const s = await ok("GET", "/v1/onboarding", pa);
  assert.equal(s.status, "applicant");
  assert.deepEqual(s.steps.map((x) => x.id), ["area", "services", "business", "identity", "background", "insurance", "skills", "safety", "payouts", "agreements"]);
  assert.ok(s.steps.every((x) => !x.done));
  assert.ok(step(s, "business").errors.includes("Add your legal first name"));
  assert.equal(s.ready, false);
  const cust = (await call("POST", "/v1/auth/signup", null, customer({ email: "onb-c@example.com" }))).body.token;
  assert.equal((await call("GET", "/v1/onboarding", cust)).status, 403, "customers don't have an application");
});

test("business & tax: answers are checked; tax IDs are never accepted or stored", async () => {
  const bad = await call("PUT", "/v1/onboarding/steps/business", pa, { zip: "3791" });
  assert.equal(bad.status, 422);
  assert.match(bad.body.error.fields.zip, /5 digits/);
  assert.equal((await call("PUT", "/v1/onboarding/steps/business", pa, { entity: "pirate" })).status, 422);
  const s = await ok("PUT", "/v1/onboarding/steps/business", pa, { legalFirst: "Amanda", legalMiddle: "Jo", legalLast: "Smith", entity: "smllc", street: "1 Oak St", city: "Knoxville", state: "tn", zip: "37919", employees: "0", tin: "123-45-6789", ssn: "123456789" });
  assert.deepEqual(s.legalName, { first: "Amanda", middle: "Jo", last: "Smith" });
  assert.equal(s.answers.business.state, "TN");
  assert.ok(step(s, "business").errors.includes("Add the business legal name"), "LLCs need their legal name");
  const row = await app.db.get(`SELECT * FROM partner_applications WHERE user_id = $1`, [paId]);
  assert.ok(!JSON.stringify(row).includes("6789"), "no tax ID stored anywhere");
  await ok("PUT", "/v1/onboarding/steps/business", pa, { businessName: "Smith Mobile Auto LLC" });
});

test("e-signatures: consent first, then the typed name must match the legal name; version and fingerprint are kept", async () => {
  let r = await call("POST", "/v1/onboarding/sign", pa, { docId: "w9", name: "Amanda Jo Smith" });
  assert.equal(r.status, 409);
  assert.match(r.body.error.message, /electronically/);
  const doc = (await ok("GET", "/v1/onboarding/documents/esign", pa)).document;
  assert.equal(doc.title, "Consent to Electronic Signatures and Records");
  assert.match(doc.draftNote, /attorney review/);
  await ok("POST", "/v1/onboarding/sign", pa, { docId: "esign" });
  r = await call("POST", "/v1/onboarding/sign", pa, { docId: "w9", name: "Amanda Smith" });
  assert.equal(r.status, 422);
  assert.match(r.body.error.fields.name, /Amanda Jo Smith/);
  const s = await ok("POST", "/v1/onboarding/sign", pa, { docId: "w9", name: "  amanda   jo SMITH " });
  assert.equal(s.signatures.w9.name, "amanda jo SMITH");
  assert.equal(s.signatures.w9.version, "0.1");
  assert.equal(step(s, "business").done, true);
  const sig = await app.db.get(`SELECT * FROM partner_signatures WHERE user_id = $1 AND doc_id = 'w9'`, [paId]);
  assert.match(sig.doc_hash, /^[0-9a-f]{64}$/);
  assert.equal(sig.ip, "127.0.0.1");
  assert.equal((await call("GET", "/v1/onboarding/documents/nope", pa)).status, 404);
});

test("identity: Stripe checks the license and selfie; only the result and 21+ are kept", async () => {
  await ok("PUT", "/v1/onboarding/steps/identity", pa, { dlState: "TN", dlExpires: "2026-11-20", yearsLicensed: "1" });
  let s = await ok("GET", "/v1/onboarding", pa);
  const errs = step(s, "identity").errors;
  assert.ok(errs.includes("Your license expires within 30 days. Renew it first"));
  assert.ok(errs.includes("You need a driver's license held for 2 years or more"));
  assert.ok(errs.includes("Verify your ID and selfie"));
  await ok("PUT", "/v1/onboarding/steps/identity", pa, { dlExpires: "2029-03-01", yearsLicensed: "10" });

  const { url } = await ok("POST", "/v1/onboarding/identity", pa, { returnUrl: "exp://192.168.1.5:8082/--/onboarding/identity" });
  const vs = stripe.state.identity[url.split("/").pop()];
  assert.equal(vs.options.document.require_matching_selfie, "true");
  assert.match(vs.return_url, /\/pay\/return\?to=exp/);
  stripe.finishIdentity(vs.id, { fail: true });
  s = await ok("POST", "/v1/onboarding/identity/sync", pa);
  assert.equal(s.identity.status, "requires_input");
  assert.match(s.identity.problem, /expired/);
  stripe.finishIdentity(vs.id, { dob: { day: 1, month: 1, year: 1990 } });
  s = await ok("POST", "/v1/onboarding/identity/sync", pa);
  assert.deepEqual([s.identity.status, s.identity.over21], ["verified", true]);
  assert.equal(step(s, "identity").done, true);
  const row = await app.db.get(`SELECT * FROM partner_applications WHERE user_id = $1`, [paId]);
  assert.ok(!JSON.stringify(row).includes("1990"), "date of birth isn't stored");

  // Under 21 can't continue.
  const { url: u2 } = await ok("POST", "/v1/onboarding/identity", pb, { returnUrl: "exp://x/--/onboarding/identity" });
  stripe.finishIdentity(u2.split("/").pop(), { dob: { day: 1, month: 12, year: 2005 } });
  // Finished at Stripe but never sent back to the app: starting again picks up the finished check instead of a new one.
  const sessions = Object.keys(stripe.state.identity).length;
  s = await ok("POST", "/v1/onboarding/identity", pb, { returnUrl: "http://localhost:8082/onboarding/identity" });
  assert.equal(s.url, undefined);
  assert.equal(s.identity.status, "verified");
  assert.equal(Object.keys(stripe.state.identity).length, sessions, "no new ID check started");
  assert.equal(s.identity.over21, false);
  assert.ok(step(s, "identity").errors.includes("You must be 21 or older to be a partner"));
});

test("background check: the disclosure stands alone and comes before the signed authorization", async () => {
  await ok("POST", "/v1/onboarding/sign", pa, { docId: "esign" });
  const r = await call("POST", "/v1/onboarding/sign", pa, { docId: "bg_auth", name: "Amanda Jo Smith" });
  assert.equal(r.status, 409);
  await ok("POST", "/v1/onboarding/sign", pa, { docId: "bg_disclosure" });
  const s = await ok("POST", "/v1/onboarding/sign", pa, { docId: "bg_auth", name: "Amanda Jo Smith" });
  assert.equal(s.background.status, "pending");
  assert.equal(s.background.note, undefined, "staff notes stay with staff");
  assert.equal(step(s, "background").done, true);
});

test("insurance: minimum limits, 30 days of coverage left, certificates, and the opt-out signature", async () => {
  let s = await ok("PUT", "/v1/onboarding/steps/insurance", pa, {
    coverage: "own", glCarrier: "Hartford", glPolicy: "GL-1", glExpires: "2026-11-20", glOccurrence: "500000", glAggregate: "2000000",
    gkCarrier: "Hartford", gkPolicy: "GK-1", gkExpires: "2027-08-01", gkLimit: "100000", autoType: "commercial", autoCarrier: "Progressive", autoPolicy: "CA-1", autoExpires: "2027-08-01", autoLimit: "1000000",
  });
  const errs = step(s, "insurance").errors;
  for (const e of ["General liability: expires in under 30 days. Renew it first", "General liability per occurrence: needs at least $1,000,000", "Upload your general liability certificate",
    "Name Auto-Auto, Inc. as an additional insured on your general liability", "Confirm your garagekeepers covers customer locations", "Sign the Own Insurance Election & Indemnity", "Confirm the workers' compensation rule"]) {
    assert.ok(errs.includes(e), `missing: ${e}\n${errs.join("\n")}`);
  }
  // Uploads: real PDFs and photos only, up to 6 MB.
  const fake = await call("POST", "/v1/onboarding/files", pa, { kind: "gl", filename: "x.pdf", contentType: "application/pdf", data: Buffer.from("hello").toString("base64") });
  assert.equal(fake.status, 422);
  assert.match(fake.body.error.fields.file, /doesn't look like/);
  assert.equal((await call("POST", "/v1/onboarding/files", pa, { kind: "gl", contentType: "text/html", data: PDF })).status, 422);
  assert.equal((await call("POST", "/v1/onboarding/files", pa, { kind: "secret", contentType: "application/pdf", data: PDF })).status, 422);
  const big = Buffer.concat([Buffer.from("%PDF-"), Buffer.alloc(6 * 1024 * 1024)]).toString("base64");
  const tooBig = await call("POST", "/v1/onboarding/files", pa, { kind: "gl", contentType: "application/pdf", data: big });
  assert.ok([413, 422].includes(tooBig.status));
  for (const k of ["gl", "gk", "auto"]) await upload(pa, k);
  s = await upload(pa, "gl"); // a replacement
  assert.equal(s.documents.filter((d) => d.kind === "gl").length, 1, "only the newest certificate counts");
  await ok("PUT", "/v1/onboarding/steps/insurance", pa, { glExpires: "2027-08-01", glOccurrence: "1000000", glAdditionalInsured: true, gkAtCustomer: true, wcAck: true });
  await ok("POST", "/v1/onboarding/sign", pa, { docId: "optout", name: "Amanda Jo Smith" });
  s = await ok("GET", "/v1/onboarding", pa);
  assert.deepEqual(step(s, "insurance").errors, []);

  // Files are private to the partner and staff.
  const id = s.documents[0].id;
  const mine = await fetch(`${app.base}/v1/onboarding/files/${id}`, { headers: { Authorization: `Bearer ${pa}` } });
  assert.equal(mine.headers.get("content-type"), "application/pdf");
  assert.equal(Buffer.from(await mine.arrayBuffer()).toString("latin1").slice(0, 5), "%PDF-");
  assert.equal((await fetch(`${app.base}/v1/onboarding/files/${id}`, { headers: { Authorization: `Bearer ${pb}` } })).status, 404);
  assert.equal((await fetch(`${app.base}/v1/admin/documents/${id}/file`, { headers: { Authorization: `Bearer ${admin}` } })).status, 200);
});

test("experience & certifications: proof required for the services that need it", async () => {
  await ok("PUT", "/v1/partner/services", pa, { serviceIds: ["oil_change", "brakes", "ac_service", "glass_chip", "lockout", "exterior_wash"] });
  let s = await ok("PUT", "/v1/onboarding/steps/skills", pa, { experience: "0", setting: "both" });
  const errs = step(s, "skills").errors;
  for (const e of ["You need 2+ years of experience or an ASE certificate", "Add your shop's street address", "Upload your shop business license", "Upload your ase certificate or brake-work proof",
    "A/C service: add your Section 609 certificate number", "Upload your epa section 609 certificate", "Upload your auto glass certification", "Upload your water containment proof", "Lockouts: confirm you'll check ID and proof of ownership"]) {
    assert.ok(errs.includes(e), `missing: ${e}\n${errs.join("\n")}`);
  }
  await ok("PUT", "/v1/partner/services", pa, { serviceIds: ["oil_change", "tire_rotation"] });
  s = await ok("PUT", "/v1/onboarding/steps/skills", pa, { experience: "5", setting: "mobile" });
  assert.equal(step(s, "skills").done, true);
});

test("submit, staff review, approval; then jobs pause if insurance lapses", async () => {
  const filled = await complete(pa, { first: "Amanda", last: "Smith", sign: "Amanda Jo Smith", autoExpires: "2027-06-01" });
  assert.ok(filled.steps.every((x) => x.done), JSON.stringify(filled.steps.filter((x) => !x.done)));
  assert.equal((await call("POST", "/v1/onboarding/submit", pa, {})).status, 422, "must certify");
  const s = await ok("POST", "/v1/onboarding/submit", pa, { certify: true });
  assert.equal(s.status, "in_review");
  assert.equal(s.locked, true);
  assert.equal((await call("PUT", "/v1/onboarding/steps/safety", pa, { lift: false })).status, 409, "locked while in review");
  assert.equal((await call("POST", "/v1/onboarding/submit", pa, { certify: true })).status, 409);

  const list = (await ok("GET", "/v1/admin/applications", admin)).applications;
  assert.equal(list[0].id, paId, "submitted applications first");
  const view = await ok("GET", `/v1/admin/applications/${paId}`, admin);
  assert.equal(view.partner.email, "onb-a@example.com");
  assert.ok(view.signatures.w9.ip, "staff see where each signature came from");
  let r = await call("POST", `/v1/admin/applications/${paId}/decision`, admin, { decision: "approve" });
  assert.equal(r.status, 409);
  assert.ok(r.body.error.blockers.some((b) => /Background check/.test(b)));
  assert.ok(r.body.error.blockers.some((b) => /Review these documents/.test(b)));
  const rej = view.documents.find((d) => d.kind === "gk");
  assert.equal((await call("POST", `/v1/admin/documents/${rej.id}/review`, admin, { status: "rejected" })).status, 422, "rejections need a reason");
  for (const d of view.documents) await ok("POST", `/v1/admin/documents/${d.id}/review`, admin, { status: "approved" });
  await ok("POST", `/v1/admin/applications/${paId}/background`, admin, { status: "clear", note: "Vendor report #123" });
  const done = await ok("POST", `/v1/admin/applications/${paId}/decision`, admin, { decision: "approve" });
  assert.equal(done.status, "active");
  assert.equal((await ok("GET", "/v1/me", pa)).user.partner.status, "active");
  assert.equal((await ok("GET", "/v1/jobs/board", pa)).blocked, null);

  // Vehicle insurance ran out (expired 2027-06-01).
  clock = Date.parse("2027-06-03T13:00:00Z");
  const board = await ok("GET", "/v1/jobs/board", pa);
  assert.match(board.blocked, /vehicle insurance expired on 2027-06-01/);
  const renewed = await ok("PUT", "/v1/onboarding/steps/insurance", pa, { autoExpires: "2028-06-01" });
  assert.equal(renewed.status, "active");
  assert.equal((await ok("GET", "/v1/jobs/board", pa)).blocked, null);
});

test("staff can send an application back with a note, or verify ID by hand", async () => {
  const s = await complete(pb, { first: "Ben", last: "Cole" });
  assert.equal(step(s, "identity").done, false, "Ben is under 21 from the earlier check");
  const v = await ok("POST", `/v1/admin/applications/${pbId}/identity`, admin, { status: "verified", over21: true });
  assert.equal(v.identity.status, "verified");
  await ok("POST", "/v1/onboarding/submit", pb, { certify: true });
  assert.equal((await call("POST", `/v1/admin/applications/${pbId}/decision`, admin, { decision: "return" })).status, 422);
  const back = await ok("POST", `/v1/admin/applications/${pbId}/decision`, admin, { decision: "return", note: "Your vehicle declarations page is cut off. Upload the full page." });
  assert.equal(back.status, "applicant");
  const mine = await ok("GET", "/v1/onboarding", pb);
  assert.equal(mine.decision, "return");
  assert.match(mine.decisionNote, /cut off/);
  assert.equal(mine.locked, false);
  await upload(pb, "auto");
});

test("arbitration opt-out works for 30 days after signing", async () => {
  const s = await ok("GET", "/v1/onboarding", pb);
  assert.ok(s.arbitration.canOptOutUntil > clock);
  const out = await ok("POST", "/v1/onboarding/arbitration-opt-out", pb);
  assert.ok(out.arbitration.optedOutAt);
  const c = (await call("POST", "/v1/auth/signup", null, partner({ email: "onb-late@example.com" }))).body.token;
  await complete(c, { first: "Amanda", last: "Smith" });
  clock += 31 * DAY;
  const late = await call("POST", "/v1/onboarding/arbitration-opt-out", c);
  assert.equal(late.status, 409);
});
