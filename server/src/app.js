// Builds the HTTP app. index.js starts it; tests call createApp directly.
import http from "node:http";
import { createRouter, send, HttpError } from "./lib/http.js";
import { createAuth } from "./auth/service.js";
import { authRoutes } from "./auth/routes.js";
import { createMailer } from "./lib/mailer.js";
import { profileRoutes } from "./profiles/routes.js";
import { createVinDecoder } from "./vehicles/vin.js";
import { pricingRoutes } from "./pricing/routes.js";
import { createSettingsStore } from "./pricing/settings.js";
import { createJobs } from "./jobs/service.js";
import { jobRoutes } from "./jobs/routes.js";
import { createGeocoder } from "./maps/geo.js";
import { createStripe } from "./payments/stripe.js";
import { createPayments } from "./payments/service.js";
import { paymentRoutes } from "./payments/routes.js";

export function createApp({ db, config, mailer = createMailer({ isProd: config.isProd }), log = console, vinFetch = config.vinLookup ? globalThis.fetch : null, mapsFetch = globalThis.fetch, stripeFetch = globalThis.fetch, now = () => Date.now() }) {
  const router = createRouter();
  const auth = createAuth({ db, config, mailer });

  router.get("/health", async (req, res) => {
    let dbOk = true;
    try { await db.get("SELECT 1 AS ok"); } catch { dbOk = false; }
    send(res, dbOk ? 200 : 503, { ok: dbOk, service: "auto-auto-api" });
  });
  authRoutes(router, { auth, config });
  const vinDecode = createVinDecoder({ db, fetchImpl: vinFetch, log: (m) => log.log ? log.log(m) : undefined });
  const geocode = createGeocoder({ apiKey: config.googleMapsKey, baseUrl: config.googleMapsBaseUrl, fetchImpl: mapsFetch, log: (m) => (log.log ? log.log(m) : undefined) });
  profileRoutes(router, { db, auth, vinDecode, geocode });
  const settings = createSettingsStore({ db, now });
  pricingRoutes(router, { db, auth, settings });
  const stripe = createStripe({ secretKey: config.stripeSecretKey, baseUrl: config.stripeBaseUrl, fetchImpl: stripeFetch });
  const payments = createPayments({ db, stripe, settings, now, log: (m) => (log.log ? log.log(m) : undefined) });
  const jobs = createJobs({ db, settings, geocode, payments, now, log: (m) => (log.log ? log.log(m) : undefined) });
  jobRoutes(router, { db, auth, jobs, now });
  paymentRoutes(router, { auth, payments, jobs, config });

  const server = http.createServer(async (req, res) => {
    const origin = req.headers.origin;
    const cors = origin && config.allowedOrigins.includes(origin)
      ? { "Access-Control-Allow-Origin": origin, "Vary": "Origin", "Access-Control-Allow-Headers": "Authorization, Content-Type", "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE", "Access-Control-Max-Age": "600" }
      : {};
    try {
      const url = new URL(req.url, "http://local");
      if (req.method === "OPTIONS") return send(res, cors["Access-Control-Allow-Origin"] ? 204 : 403, undefined, cors);
      const m = router.match(req.method, url.pathname);
      if (!m) throw new HttpError(404, "not_found", "That page doesn't exist.");
      if (m.methodNotAllowed) throw new HttpError(405, "method_not_allowed", "That method isn't allowed here.");
      req.params = m.params;
      req.query = url.searchParams;
      // Handlers call send(); CORS headers are added by wrapping writeHead.
      const wh = res.writeHead.bind(res);
      res.writeHead = (status, headers) => wh(status, { ...headers, ...cors });
      await m.handler(req, res);
    } catch (e) {
      if (e instanceof HttpError) {
        const headers = e.extra.retryAfter ? { "Retry-After": String(e.extra.retryAfter), ...cors } : cors;
        if (!res.headersSent) send(res, e.status, { error: { code: e.code, message: e.message, ...e.extra } }, headers);
      } else {
        log.error("[error]", req.method, req.url, e);
        if (!res.headersSent) send(res, 500, { error: { code: "server_error", message: "Something went wrong on our side. Try again." } }, cors);
      }
    }
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  return { server, auth, mailer, settings, jobs, payments };
}
