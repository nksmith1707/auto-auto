// PAYOUT_SETUP_REQUIRED=off: partners can apply before Stripe payout setup works, and set it up later.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startTestApp, partner } from "./helpers.js";
import { createFakeStripe } from "./fake-stripe.js";

let app, token;
const ok = async (m, p, body) => {
  const r = await app.call(m, p, { token, body });
  assert.equal(r.status, 200, `${m} ${p} → ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
};
const payoutsStep = (s) => s.steps.find((x) => x.id === "payouts");

before(async () => {
  const stripe = createFakeStripe();
  app = await startTestApp({ STRIPE_SECRET_KEY: "sk_test_fake", PAYOUT_SETUP_REQUIRED: "off" }, { stripeFetch: stripe.fetch });
  token = (await app.call("POST", "/v1/auth/signup", { body: partner({ email: "later@example.com" }) })).body.token;
});
after(async () => { await app.close(); });

test("payout setup can wait; the tax and tips statements are still needed", async () => {
  let s = await ok("GET", "/v1/onboarding");
  assert.equal(s.payouts.required, false);
  assert.deepEqual(payoutsStep(s).errors, ["Confirm the tax statement", "Confirm the tips statement"]);
  s = await ok("PUT", "/v1/onboarding/steps/payouts", { tax1099: true, tips: true });
  assert.equal(payoutsStep(s).done, true);
});
