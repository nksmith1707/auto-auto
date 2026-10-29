// Payment endpoints: customer cards, paying what's due, partner payouts, and the page Stripe sends people back to.
import { readJson, send, HttpError } from "../lib/http.js";
import { requireUser } from "../auth/routes.js";

// Where /pay/return may send people: the phone apps (and Expo Go while testing), or the apps running in a browser
// on the person's own computer (localhost only, which can't point anywhere else).
export function safeReturn(to) {
  if (!to) return null;
  let u;
  try { u = new URL(to); } catch { return null; }
  if (["autoauto:", "autoautopartner:", "exp:", "exps:"].includes(u.protocol)) return u.toString();
  if (u.protocol === "http:" && ["localhost", "127.0.0.1"].includes(u.hostname) && !u.username && !u.password) return u.toString();
  return null;
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export function paymentRoutes(router, { auth, payments, jobs, config }) {
  const apiBase = (req) => {
    if (config.publicUrl) return config.publicUrl.replace(/\/$/, "");
    const proto = config.trustProxy && req.headers["x-forwarded-proto"] ? String(req.headers["x-forwarded-proto"]).split(",")[0] : "http";
    return `${proto}://${req.headers.host}`;
  };
  const who = async (req, roles) => (await requireUser(req, auth, roles)).user;

  router.get("/v1/payments/config", async (req, res) => {
    await who(req, ["customer", "partner"]);
    send(res, 200, { enabled: payments.enabled, publishableKey: payments.enabled ? config.stripePublishableKey : null, testMode: !!(config.stripePublishableKey || "").startsWith("pk_test") });
  });

  // ---------- Customer cards ----------
  router.get("/v1/payments/cards", async (req, res) => {
    const u = await who(req, ["customer"]);
    send(res, 200, { cards: await payments.listCards(u), enabled: payments.enabled });
  });
  router.post("/v1/payments/cards/setup", async (req, res) => {
    const u = await who(req, ["customer"]);
    const b = await readJson(req);
    send(res, 200, await payments.startCardSetup(u, { returnTo: safeReturn(b.returnUrl, config) || "", apiBase: apiBase(req) }));
  });
  router.post("/v1/payments/cards/sync", async (req, res) => {
    const u = await who(req, ["customer"]);
    send(res, 200, { cards: await payments.syncCards(u) });
  });
  router.post("/v1/payments/cards/:id/default", async (req, res) => {
    const u = await who(req, ["customer"]);
    send(res, 200, { cards: await payments.setDefaultCard(u, req.params.id) });
  });
  router.delete("/v1/payments/cards/:id", async (req, res) => {
    const u = await who(req, ["customer"]);
    send(res, 200, { cards: await payments.removeCard(u, req.params.id) });
  });
  router.post("/v1/jobs/:id/pay", async (req, res) => {
    const u = await who(req, ["customer"]);
    const job = await jobs.rawJob(req.params.id);
    if (!job) throw new HttpError(404, "not_found", "That job isn't on your account.");
    await payments.retry(u, job);
    send(res, 200, { job: await jobs.getForCustomer(u, req.params.id) });
  });

  // ---------- Partner payouts ----------
  router.get("/v1/payouts", async (req, res) => {
    const u = await who(req, ["partner"]);
    send(res, 200, await payments.payoutInfo(u));
  });
  router.post("/v1/payouts/account", async (req, res) => {
    const u = await who(req, ["partner"]);
    const b = await readJson(req);
    send(res, 200, await payments.startPayoutSetup(u, { returnTo: safeReturn(b.returnUrl, config) || "", apiBase: apiBase(req) }));
  });
  router.post("/v1/payouts/account/sync", async (req, res) => {
    const u = await who(req, ["partner"]);
    send(res, 200, await payments.syncPayoutAccount(u));
  });
  router.post("/v1/payouts/instant", async (req, res) => {
    const u = await who(req, ["partner"]);
    const r = await payments.cashOut(u);
    send(res, 200, { ...r, ...(await payments.payoutInfo(u)) });
  });

  // Stripe's pages send people here when they finish. We send them back into the app.
  router.get("/pay/return", async (req, res) => {
    const to = safeReturn(req.query.get("to"), config);
    const ok = req.query.get("ok") === "1";
    if (to) {
      const u = new URL(to);
      u.searchParams.set("done", ok ? "1" : "0");
      res.writeHead(302, { Location: u.toString(), "Cache-Control": "no-store" });
      return res.end();
    }
    const msg = ok ? "All set. Go back to the Auto-Auto app to continue." : "Nothing was changed. Go back to the Auto-Auto app to continue.";
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    res.end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Auto-Auto</title><body style="font-family:system-ui;padding:32px;text-align:center"><h2>${esc(msg)}</h2></body>`);
  });
}
