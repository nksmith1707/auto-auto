// The phone apps' API client (apps/shared/api.js) against the real server, so the apps and API can't drift apart.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startTestApp } from "./helpers.js";
import { createApi, ApiError, passwordHint, formatPhone } from "../../apps/shared/api.js";

let app, api;
before(async () => {
  app = await startTestApp();
  api = createApi({ baseUrl: app.base + "/" });
});
after(async () => { await app.close(); });

const resetCode = (email) => {
  const m = [...app.mailer.outbox].reverse().find((x) => x.to === email);
  return m && /\n\n(rs_\S+)\n\n/.exec(m.text)[1];
};

async function rejects(promise, check) {
  try { await promise; } catch (e) { assert.ok(e instanceof ApiError, `expected ApiError, got ${e}`); check(e); return; }
  assert.fail("expected the call to fail");
}

test("customer: sign up, see account, log out, log back in", async () => {
  const out = await api.signup({ role: "customer", firstName: "Jordan", lastName: "Reese", email: "jordan.app@example.com", phone: "865 555 0100", password: "Blue-Wrench-77", acceptTerms: true });
  assert.equal(out.user.role, "customer");
  assert.equal(out.user.phone, "+18655550100");
  assert.equal(formatPhone(out.user.phone), "(865) 555-0100");

  const me = await api.me(out.token);
  assert.equal(me.user.email, "jordan.app@example.com");

  assert.equal(await api.logout(out.token), null);
  await rejects(api.me(out.token), (e) => { assert.equal(e.status, 401); assert.equal(e.code, "not_signed_in"); });

  const again = await api.login({ email: "Jordan.App@example.com", password: "Blue-Wrench-77" });
  assert.equal(again.user.firstName, "Jordan");
});

test("partner: sign up needs a mobile number and starts as an applicant", async () => {
  await rejects(api.signup({ role: "partner", firstName: "Amanda", lastName: "Smith", email: "amanda.app@example.com", password: "Torque-Spec-2026", acceptTerms: true }),
    (e) => { assert.equal(e.status, 422); assert.equal(e.code, "invalid_input"); assert.match(e.fields.phone, /mobile number/); });
  const out = await api.signup({ role: "partner", firstName: "Amanda", lastName: "Smith", email: "amanda.app@example.com", phone: "(865) 555-0177", password: "Torque-Spec-2026", acceptTerms: true });
  assert.deepEqual(out.user.partner, { status: "applicant", serviceAreaSet: false, servicesCount: 0, payoutsEnabled: false });
});

test("errors come back as plain-English messages per field", async () => {
  await rejects(api.signup({ role: "customer", firstName: "", lastName: "X", email: "nope", password: "short", acceptTerms: false }), (e) => {
    assert.equal(e.status, 422);
    assert.ok(e.fields.firstName && e.fields.email && e.fields.acceptTerms);
  });
  await rejects(api.signup({ role: "customer", firstName: "J", lastName: "R", email: "jordan.app@example.com", password: "Blue-Wrench-77", acceptTerms: true }),
    (e) => { assert.equal(e.status, 409); assert.equal(e.code, "email_taken"); assert.match(e.message, /already an account/); });
  await rejects(api.login({ email: "jordan.app@example.com", password: "wrong-password-1" }),
    (e) => { assert.equal(e.status, 401); assert.equal(e.code, "bad_credentials"); });
});

test("password reset: request a code, set a new password, old sessions end", async () => {
  const s = await api.login({ email: "jordan.app@example.com", password: "Blue-Wrench-77" });
  const r = await api.requestReset("jordan.app@example.com");
  assert.match(r.message, /reset code/);
  const code = resetCode("jordan.app@example.com");
  assert.ok(code, "a reset email was sent");

  await rejects(api.confirmReset({ token: code, password: "short" }), (e) => { assert.equal(e.status, 422); assert.ok(e.fields.password); });
  assert.equal(await api.confirmReset({ token: code, password: "New-Brake-Pads-9" }), null);
  await rejects(api.me(s.token), (e) => assert.equal(e.status, 401));
  await rejects(api.confirmReset({ token: code, password: "Another-One-123" }), (e) => assert.equal(e.code, "reset_invalid"));
  await rejects(api.login({ email: "jordan.app@example.com", password: "Blue-Wrench-77" }), (e) => assert.equal(e.status, 401));
  const ok = await api.login({ email: "jordan.app@example.com", password: "New-Brake-Pads-9" });
  assert.equal(ok.user.email, "jordan.app@example.com");
});

test("reset for an unknown email looks the same and sends nothing", async () => {
  const before = app.mailer.outbox.length;
  const r = await api.requestReset("nobody.here@example.com");
  assert.match(r.message, /If there's an account/);
  assert.equal(app.mailer.outbox.length, before);
});

test("log out everywhere ends every session", async () => {
  const a = await api.login({ email: "amanda.app@example.com", password: "Torque-Spec-2026" });
  const b = await api.login({ email: "amanda.app@example.com", password: "Torque-Spec-2026" });
  await api.logoutAll(a.token);
  await rejects(api.me(b.token), (e) => assert.equal(e.status, 401));
});

test("no connection and timeouts give a clear message", async () => {
  const down = createApi({ baseUrl: "http://127.0.0.1:9", timeoutMs: 2000 });
  await rejects(down.health(), (e) => { assert.equal(e.code, "network"); assert.match(e.message, /Can't reach Auto-Auto/); });
  const slow = createApi({ baseUrl: app.base, timeoutMs: 5, fetchImpl: (url, opts) => new Promise((_, reject) => opts.signal.addEventListener("abort", () => reject(new Error("aborted")))) });
  await rejects(slow.health(), (e) => { assert.equal(e.code, "timeout"); assert.match(e.message, /too long/); });
});

test("the app's password hints match the server's rules", () => {
  assert.equal(passwordHint(""), "Enter a password.");
  assert.equal(passwordHint("short"), "Use at least 10 characters.");
  assert.equal(passwordHint("aaaaaaaaaaaa"), "Don't use the same character over and over.");
  assert.equal(passwordHint("jordanreese99!", "jordanreese@example.com"), "Don't use your email in your password.");
  assert.equal(passwordHint("Blue-Wrench-77", "jordan@example.com"), null);
});
