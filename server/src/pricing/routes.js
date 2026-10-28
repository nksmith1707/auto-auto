// Pricing endpoints: live settings, publishing a new version (admins), the price menu, and quotes.
import { readJson, send, HttpError } from "../lib/http.js";
import { requireUser } from "../auth/routes.js";
import { CATEGORIES, SERVICES } from "../catalog/services.js";
import { priceLine, customerTotal, partnerPay, glassQuote, menuItem, PricingError } from "./engine.js";
import { metaOut } from "./settings.js";
import { vehicleOut } from "../profiles/routes.js";

const MAX_SERVICES = 15;
const bad = (field, msg) => new HttpError(422, "invalid_input", "Some fields need fixing.", { fields: { [field]: msg } });
const fail = (e) => { if (e instanceof PricingError) throw new HttpError(422, "invalid_input", e.message); throw e; };

// Customers never see what partners earn or what Auto-Auto keeps.
function forCustomer(line) {
  const { laborCents, partsCostCents, partnerEarnsCents, ...rest } = line;
  return { ...rest, laborCents };
}

export function pricingRoutes(router, { db, auth, settings }) {
  // Vehicle for pricing: a customer's own saved vehicle, or a make/model for partners and staff.
  async function vehicleFor(s, b) {
    if (b.vehicleId) {
      if (s.user.role !== "customer") throw bad("vehicleId", "Only customers can price their saved vehicles.");
      const v = await db.get(`SELECT * FROM vehicles WHERE id = $1 AND user_id = $2 AND archived_at IS NULL`, [String(b.vehicleId), s.user.id]);
      if (!v) throw new HttpError(404, "not_found", "That vehicle isn't on your account. Pull to refresh and try again.");
      return vehicleOut(v);
    }
    const make = typeof b.make === "string" ? b.make.trim().slice(0, 40) : "";
    const model = typeof b.model === "string" ? b.model.trim().slice(0, 40) : "";
    return make || model ? { make, model, year: Number(b.year) || null } : null;
  }

  // Internal numbers (markups, platform fee, deductible): staff only. Apps get prices from the menu and quotes.
  router.get("/v1/pricing/settings", async (req, res) => {
    await requireUser(req, auth, ["admin"]);
    const cur = await settings.current();
    send(res, 200, { version: cur.version, settings: cur.settings, meta: metaOut(), publishedAt: cur.createdAt });
  });

  router.get("/v1/pricing/settings/history", async (req, res) => {
    await requireUser(req, auth, ["admin"]);
    send(res, 200, { versions: await settings.history() });
  });

  router.post("/v1/pricing/settings", async (req, res) => {
    const s = await requireUser(req, auth, ["admin"]);
    const b = await readJson(req);
    const out = await settings.publish({ changes: b.changes, note: b.note, userId: s.user.id, expectedVersion: b.expectedVersion });
    send(res, 201, out);
  });

  // Every service with its price for one vehicle. Partners also see what they'd earn for that job alone.
  router.get("/v1/pricing/menu", async (req, res) => {
    const s = await requireUser(req, auth);
    const q = Object.fromEntries(req.query);
    const vehicle = await vehicleFor(s, q);
    const cur = await settings.current();
    const role = s.user.role;
    const items = SERVICES.filter((x) => role !== "customer" || x.category !== "fleet").map((x) => {
      const m = menuItem(x.id, vehicle, cur.settings);
      return role === "customer" ? forCustomer(m) : m;
    });
    send(res, 200, {
      settingsVersion: cur.version, vehicle, categories: CATEGORIES.filter((c) => role !== "customer" || c.id !== "fleet"), items,
      fees: { mobileCents: Math.round(cur.settings.mobile * 100), protectionCents: Math.round(cur.settings.protect * 100), laborRate: cur.settings.labor, shopLaborRate: cur.settings.shopLabor },
      sampleBookTimes: true,
    });
  });

  // A full visit: services for one vehicle, fees, deposit, and (for partners and staff) partner pay.
  router.post("/v1/quotes", async (req, res) => {
    const s = await requireUser(req, auth);
    const b = await readJson(req);
    const ids = b.serviceIds;
    if (!Array.isArray(ids) || !ids.length) throw bad("serviceIds", "Pick at least one service.");
    if (ids.length > MAX_SERVICES) throw bad("serviceIds", `Pick up to ${MAX_SERVICES} services per visit.`);
    if (new Set(ids).size !== ids.length) throw bad("serviceIds", "Each service can only be added once per visit.");
    const vehicle = await vehicleFor(s, b);
    const cur = await settings.current();
    const role = s.user.role;
    let lines;
    try { lines = ids.map((id) => priceLine(String(id), vehicle, cur.settings)); } catch (e) { fail(e); }
    if (role === "customer" && lines.some((l) => l.fleetOnly)) throw bad("serviceIds", "Fleet services are booked through a fleet account.");
    const total = customerTotal(lines, cur.settings, { mobile: true });
    const out = { settingsVersion: cur.version, vehicle, quote: { ...total, lines: total.lines.map((l) => (role === "customer" ? forCustomer(l) : l)) } };
    if (role !== "customer") {
      const pay = partnerPay(lines, cur.settings, { mobile: true });
      out.partnerPay = role === "admin" ? pay : (({ platformCents, ...rest }) => rest)(pay);
    }
    send(res, 200, out);
  });

  // Glass replacement quote from the partner's supplier cost.
  router.post("/v1/quotes/glass", async (req, res) => {
    const s = await requireUser(req, auth, ["partner", "admin"]);
    const b = await readJson(req);
    const cost = Number(b.glassCost);
    if (!Number.isFinite(cost) || cost <= 0) throw bad("glassCost", "Enter the glass cost from your supplier, like 289.50.");
    if (cost > 10000) throw bad("glassCost", "That's more than we can quote in the app. Call partner support.");
    const vehicle = await vehicleFor(s, b);
    const cur = await settings.current();
    let q;
    try { q = glassQuote({ serviceId: String(b.serviceId || ""), glassCostCents: Math.round(cost * 100), needsCalibration: b.needsCalibration === true, vehicle }, cur.settings); } catch (e) { fail(e); }
    const total = customerTotal([q], cur.settings, { mobile: true });
    const pay = partnerPay([q], cur.settings, { mobile: true });
    send(res, 200, { settingsVersion: cur.version, glass: q, quote: total, partnerPay: s.user.role === "admin" ? pay : (({ platformCents, ...rest }) => rest)(pay) });
  });
}
