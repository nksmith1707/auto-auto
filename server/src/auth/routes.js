import { readJson, send, bearer, clientIp, HttpError } from "../lib/http.js";
import { checker } from "../lib/validate.js";
import { createLimiter } from "../lib/ratelimit.js";

export function authRoutes(router, { auth, config }) {
  // 10 sign-in attempts per email per 15 minutes, and 50 per IP. Sign-ups and reset requests: 10 per IP per hour.
  const loginByEmail = createLimiter({ limit: 10, windowMs: 15 * 60_000 });
  const loginByIp = createLimiter({ limit: 50, windowMs: 15 * 60_000 });
  const signupByIp = createLimiter({ limit: 10, windowMs: 60 * 60_000 });
  const resetByIp = createLimiter({ limit: 10, windowMs: 60 * 60_000 });

  const ipOf = (req) => clientIp(req, config.trustProxy);
  const limited = (wait) => { if (wait) throw new HttpError(429, "too_many_attempts", `Too many tries. Wait ${Math.ceil(wait / 60)} minute${wait > 60 ? "s" : ""} and try again.`, { retryAfter: wait }); };
  const device = (req) => req.headers["user-agent"] || null;

  router.post("/v1/auth/signup", async (req, res) => {
    const ip = ipOf(req);
    limited(signupByIp.hit(ip));
    const b = await readJson(req);
    const c = checker();
    const role = c.oneOf("role", b.role, ["customer", "partner"], "Choose customer or partner.");
    const email = c.email("email", b.email);
    const firstName = c.name("firstName", b.firstName, "first name");
    const lastName = c.name("lastName", b.lastName, "last name");
    const phone = c.phone("phone", b.phone, { required: role === "partner" });
    if (typeof b.password !== "string" || !b.password) c.add("password", "Enter a password.");
    if (b.acceptTerms !== true) c.add("acceptTerms", "Agree to the Terms of Service and Privacy Policy to continue.");
    c.done();
    const out = await auth.signup({ role, email, password: b.password, firstName, lastName, phone }, { ip, device: device(req) });
    send(res, 201, out);
  });

  router.post("/v1/auth/login", async (req, res) => {
    const ip = ipOf(req);
    const b = await readJson(req);
    const c = checker();
    const email = c.email("email", b.email);
    if (typeof b.password !== "string" || !b.password) c.add("password", "Enter your password.");
    c.done();
    limited(loginByIp.hit(ip) || loginByEmail.hit(email));
    const out = await auth.login({ email, password: b.password }, { ip, device: device(req) });
    loginByEmail.reset(email);
    send(res, 200, out);
  });

  router.post("/v1/auth/logout", async (req, res) => {
    const s = await requireUser(req, auth);
    await auth.logout(s.sessionId);
    send(res, 204);
  });

  router.post("/v1/auth/logout-all", async (req, res) => {
    const s = await requireUser(req, auth);
    await auth.logoutEverywhere(s.user.id);
    send(res, 204);
  });

  router.get("/v1/me", async (req, res) => {
    const s = await requireUser(req, auth);
    send(res, 200, { user: await auth.publicUser(s.user) });
  });

  router.post("/v1/auth/password-reset", async (req, res) => {
    const ip = ipOf(req);
    limited(resetByIp.hit(ip));
    const b = await readJson(req);
    const c = checker();
    const email = c.email("email", b.email);
    c.done();
    await auth.requestReset(email, { ip });
    send(res, 202, { message: "If there's an account with that email, we sent a reset code." });
  });

  router.post("/v1/auth/password-reset/confirm", async (req, res) => {
    const ip = ipOf(req);
    limited(resetByIp.hit(ip));
    const b = await readJson(req);
    const c = checker();
    const token = c.string("token", b.token, { max: 200, msg: "Enter the reset code from your email." });
    if (typeof b.password !== "string" || !b.password) c.add("password", "Enter a new password.");
    c.done();
    await auth.confirmReset({ token, password: b.password }, { ip });
    send(res, 204);
  });
}

export async function requireUser(req, auth, roles) {
  const s = await auth.authenticate(bearer(req));
  if (!s) throw new HttpError(401, "not_signed_in", "Sign in to continue.");
  if (roles && !roles.includes(s.user.role)) throw new HttpError(403, "forbidden", "Your account can't do that.");
  return s;
}
