import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startTestApp, customer, partner } from "./helpers.js";

let app;
before(async () => { app = await startTestApp(); });
after(async () => { await app.close(); });

test("health check reports the database is up", async () => {
  const r = await app.call("GET", "/health");
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.equal(r.headers.get("x-content-type-options"), "nosniff");
});

test("customer signs up and gets a session", async () => {
  const r = await app.call("POST", "/v1/auth/signup", { body: customer({ email: "  Jordan@Example.com " }) });
  assert.equal(r.status, 201);
  assert.equal(r.body.user.role, "customer");
  assert.equal(r.body.user.email, "jordan@example.com", "email is trimmed and lowercased");
  assert.match(r.body.token, /^aa_[\w-]{40,}$/);
  assert.ok(r.body.expiresAt > Date.now());
  assert.equal(r.body.user.password_hash, undefined, "never returns the password hash");
  assert.equal(JSON.stringify(r.body).includes("scrypt"), false);
  const me = await app.call("GET", "/v1/me", { token: r.body.token });
  assert.equal(me.status, 200);
  assert.equal(me.body.user.firstName, "Jordan");
});

test("same email can't sign up twice, even with different case", async () => {
  const r = await app.call("POST", "/v1/auth/signup", { body: customer({ email: "JORDAN@example.com" }) });
  assert.equal(r.status, 409);
  assert.equal(r.body.error.code, "email_taken");
});

test("partner signs up as an applicant with a normalized phone", async () => {
  const r = await app.call("POST", "/v1/auth/signup", { body: partner() });
  assert.equal(r.status, 201);
  assert.equal(r.body.user.role, "partner");
  assert.equal(r.body.user.phone, "+18655550177");
  assert.deepEqual(r.body.user.partner, { status: "applicant" });
});

test("partners must give a mobile number; nobody can sign up as admin", async () => {
  const r1 = await app.call("POST", "/v1/auth/signup", { body: partner({ email: "nophone@example.com", phone: "" }) });
  assert.equal(r1.status, 422);
  assert.ok(r1.body.error.fields.phone);
  const r2 = await app.call("POST", "/v1/auth/signup", { body: customer({ email: "boss@example.com", role: "admin" }) });
  assert.equal(r2.status, 422);
  assert.ok(r2.body.error.fields.role);
});

test("signup checks every field and explains what to fix", async () => {
  const r = await app.call("POST", "/v1/auth/signup", { body: { role: "customer", email: "bad", password: "short", firstName: "", lastName: "<script>", acceptTerms: false } });
  assert.equal(r.status, 422);
  const f = r.body.error.fields;
  assert.ok(f.email && f.firstName && f.lastName && f.acceptTerms);
});

test("weak passwords are refused", async () => {
  for (const pw of ["short", "aaaaaaaaaaaa", "password123", "pat.smith-rules"]) {
    const r = await app.call("POST", "/v1/auth/signup", { body: customer({ email: "pat.smith@example.com", password: pw }) });
    assert.equal(r.status, 422, pw);
    assert.ok(r.body.error.fields.password, pw);
  }
});

test("sign in works; wrong password and unknown email get the same answer", async () => {
  const ok = await app.call("POST", "/v1/auth/login", { body: { email: "jordan@example.com", password: "Correct-Horse-42" } });
  assert.equal(ok.status, 200);
  assert.ok(ok.body.token);
  const wrong = await app.call("POST", "/v1/auth/login", { body: { email: "jordan@example.com", password: "Wrong-Horse-42" } });
  const unknown = await app.call("POST", "/v1/auth/login", { body: { email: "nobody@example.com", password: "Wrong-Horse-42" } });
  assert.equal(wrong.status, 401);
  assert.equal(unknown.status, 401);
  assert.deepEqual(wrong.body, unknown.body);
});

test("tokens are stored only as hashes", async () => {
  const r = await app.call("POST", "/v1/auth/login", { body: { email: "jordan@example.com", password: "Correct-Horse-42" } });
  const rows = await app.db.all("SELECT token_hash FROM sessions");
  assert.ok(rows.length > 0);
  assert.ok(rows.every((x) => x.token_hash !== r.body.token && /^[0-9a-f]{64}$/.test(x.token_hash)));
  const u = await app.db.get("SELECT password_hash FROM users WHERE email = $1", ["jordan@example.com"]);
  assert.match(u.password_hash, /^scrypt\$32768\$8\$1\$/);
});

test("sign out ends that session only", async () => {
  const a = await app.call("POST", "/v1/auth/login", { body: { email: "jordan@example.com", password: "Correct-Horse-42" } });
  const b = await app.call("POST", "/v1/auth/login", { body: { email: "jordan@example.com", password: "Correct-Horse-42" } });
  assert.equal((await app.call("POST", "/v1/auth/logout", { token: a.body.token })).status, 204);
  assert.equal((await app.call("GET", "/v1/me", { token: a.body.token })).status, 401);
  assert.equal((await app.call("GET", "/v1/me", { token: b.body.token })).status, 200);
  assert.equal((await app.call("POST", "/v1/auth/logout-all", { token: b.body.token })).status, 204);
  assert.equal((await app.call("GET", "/v1/me", { token: b.body.token })).status, 401);
});

test("bad or missing tokens are rejected", async () => {
  assert.equal((await app.call("GET", "/v1/me")).status, 401);
  assert.equal((await app.call("GET", "/v1/me", { token: "aa_notreal" })).status, 401);
  assert.equal((await app.call("GET", "/v1/me", { headers: { Authorization: "Basic abc" } })).status, 401);
});

test("password reset: same reply for any email, code works once, old sessions end", async () => {
  const s = await app.call("POST", "/v1/auth/login", { body: { email: "amanda@example.com", password: "Wrench-Ready-2026" } });
  const known = await app.call("POST", "/v1/auth/password-reset", { body: { email: "amanda@example.com" } });
  const unknown = await app.call("POST", "/v1/auth/password-reset", { body: { email: "ghost@example.com" } });
  assert.equal(known.status, 202);
  assert.deepEqual(known.body, unknown.body);
  const mail = app.mailer.outbox.at(-1);
  assert.equal(mail.to, "amanda@example.com");
  const code = /(rs_[\w-]+)/.exec(mail.text)[1];
  const stored = await app.db.all("SELECT token_hash FROM password_resets");
  assert.ok(stored.every((x) => x.token_hash !== code));
  const done = await app.call("POST", "/v1/auth/password-reset/confirm", { body: { token: code, password: "New-Brakes-2026" } });
  assert.equal(done.status, 204);
  assert.equal((await app.call("GET", "/v1/me", { token: s.body.token })).status, 401, "old sessions are signed out");
  const again = await app.call("POST", "/v1/auth/password-reset/confirm", { body: { token: code, password: "Other-Brakes-2026" } });
  assert.equal(again.status, 400);
  assert.equal((await app.call("POST", "/v1/auth/login", { body: { email: "amanda@example.com", password: "Wrench-Ready-2026" } })).status, 401);
  assert.equal((await app.call("POST", "/v1/auth/login", { body: { email: "amanda@example.com", password: "New-Brakes-2026" } })).status, 200);
});

test("bad requests get clear errors", async () => {
  assert.equal((await app.call("POST", "/v1/auth/login", { raw: "{not json" })).status, 400);
  assert.equal((await app.call("POST", "/v1/auth/login", { raw: "[1,2]" })).status, 400);
  const noType = await fetch(app.base + "/v1/auth/login", { method: "POST", body: "{}" });
  assert.equal(noType.status, 415);
  assert.equal((await app.call("GET", "/v1/auth/login")).status, 405);
  assert.equal((await app.call("GET", "/nope")).status, 404);
  const big = await app.call("POST", "/v1/auth/login", { raw: JSON.stringify({ email: "a@b.co", password: "x".repeat(70_000) }) }).catch(() => ({ status: 413 }));
  assert.equal(big.status, 413);
});

test("CORS only for allowed web origins", async () => {
  const ok = await fetch(app.base + "/v1/me", { method: "OPTIONS", headers: { Origin: "https://ops.example.com" } });
  assert.equal(ok.status, 204);
  assert.equal(ok.headers.get("access-control-allow-origin"), "https://ops.example.com");
  const bad = await fetch(app.base + "/v1/me", { method: "OPTIONS", headers: { Origin: "https://evil.example.com" } });
  assert.equal(bad.status, 403);
  assert.equal(bad.headers.get("access-control-allow-origin"), null);
});

test("too many wrong passwords locks that email for a while", async () => {
  let last;
  for (let i = 0; i < 11; i++) last = await app.call("POST", "/v1/auth/login", { body: { email: "target@example.com", password: "Guess-Number-" + i } });
  assert.equal(last.status, 429);
  assert.ok(Number(last.headers.get("retry-after")) > 0);
});
