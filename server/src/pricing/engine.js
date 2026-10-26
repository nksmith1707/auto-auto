// The pricing engine: every price, fee, deposit, and partner payout comes from here.
// Pure functions: give them the settings for a version and they return amounts in whole cents.
// Rules come from docs/RULES.md (Pricing, Partner pay, Booking and payment, Fleet).
import { RATES, VEHICLE_FACTORS, SHOP_MARKUP, FLEET_CLASSES, FLEET_HOUR_FACTOR, FLEET_PARTS_FACTOR } from "./rates.js";
import { serviceById } from "../catalog/services.js";

const cents = (dollars) => Math.round(dollars * 100);
const roundHours = (h) => Math.round(h * 10) / 10;

export function markupPct(partsCost, s, { fluid = false } = {}) {
  if (fluid) return s.mkFluid;
  return partsCost < 50 ? s.mk50 : partsCost < 200 ? s.mk200 : partsCost < 500 ? s.mk500 : s.mkTop;
}

function shopPrice(hours, partsCost, s) {
  const mk = SHOP_MARKUP.find(([limit]) => partsCost < limit)[1];
  return Math.round(hours * s.shopLabor + partsCost * (1 + mk));
}

export function vehicleFactor(vehicle) {
  const name = vehicle ? `${vehicle.make || ""} ${vehicle.model || ""}` : "";
  const hit = VEHICLE_FACTORS.find(([m]) => name.toLowerCase().includes(m.toLowerCase()));
  return hit ? hit[1] : 1;
}

class PricingError extends Error {}
export { PricingError };

// One service for one vehicle, at customer prices.
export function priceLine(serviceId, vehicle, s) {
  const svc = serviceById(serviceId);
  const r = RATES[serviceId];
  if (!svc || !r) throw new PricingError(`We can't price "${serviceId}" yet.`);
  const base = { serviceId, name: svc.name, category: svc.category, kind: r.kind };

  if (r.kind === "book") {
    const hours = roundHours(r.hours * vehicleFactor(vehicle));
    const mk = markupPct(r.parts, s, { fluid: r.fluid });
    const labor = Math.round(hours * s.labor);
    const partsPrice = Math.round(r.parts * (1 + mk / 100));
    return {
      ...base, hours, laborCents: cents(labor), partsCostCents: cents(r.parts), partsPriceCents: cents(partsPrice), markupPct: mk,
      priceCents: cents(labor + partsPrice), shopPriceCents: cents(shopPrice(hours, r.parts, s)),
    };
  }
  if (r.kind === "quick") {
    const partsPrice = cents(r.parts * (1 + s.quickMk / 100));
    return { ...base, hours: null, flat: true, laborCents: cents(r.labor), partsCostCents: cents(r.parts), partsPriceCents: partsPrice, markupPct: s.quickMk, priceCents: cents(r.labor) + partsPrice, shopPriceCents: null };
  }
  if (r.kind === "fixed") {
    return { ...base, hours: null, laborCents: cents(r.price - r.parts), partsCostCents: cents(r.parts), partsPriceCents: cents(r.parts), markupPct: 0, priceCents: cents(r.price), shopPriceCents: null };
  }
  if (r.kind === "diag") {
    return { ...base, hours: null, laborCents: cents(s.diag), partsCostCents: 0, partsPriceCents: 0, markupPct: 0, priceCents: cents(s.diag), shopPriceCents: null, creditDays: 7 };
  }
  if (r.kind === "glass") {
    return { ...base, hours: r.hours, quoted: true, priceCents: null, typicalCents: r.typical.map(cents), laborCents: null, partsCostCents: null, partsPriceCents: null, shopPriceCents: null };
  }
  if (r.kind === "fleet") {
    return { ...base, fleetOnly: true, priceCents: null };
  }
  throw new PricingError(`Unknown pricing for ${serviceId}.`);
}

// Glass replacement quote from the partner's real glass cost (RULES.md, Glass).
// Customer price = cost + glass markup + install kit + book-time labor + camera calibration when needed.
export function glassQuote({ serviceId, glassCostCents, needsCalibration = false, vehicle }, s) {
  const r = RATES[serviceId];
  if (!r || r.kind !== "glass") throw new PricingError("Only glass replacements are quoted this way.");
  if (!Number.isInteger(glassCostCents) || glassCostCents <= 0) throw new PricingError("Enter the glass cost from your supplier.");
  const hours = roundHours(r.hours * vehicleFactor(vehicle));
  const glassPrice = Math.round(glassCostCents * (1 + s.glassMk / 100));
  const kit = cents(s.glassKit);
  const labor = cents(hours * s.labor);
  const calibration = needsCalibration && r.calibrationHours ? cents(r.calibrationHours * s.labor) : 0;
  const priceCents = glassPrice + kit + labor + calibration;
  return {
    serviceId, name: serviceById(serviceId).name, hours, glassCostCents, glassPriceCents: glassPrice, kitCents: kit, laborCents: labor + calibration,
    calibrationCents: calibration, partsCostCents: glassCostCents + kit, partsPriceCents: glassPrice + kit, priceCents,
    // Above the typical range the partner must attach the supplier's quote and a note.
    needsSupplierQuote: priceCents > cents(r.typical[1]),
  };
}

// One service on one fleet vehicle (RULES.md, Fleet). laborRate is the fleet's own rate.
export function fleetLine(serviceId, vehicleClass, s, { laborRate = s.fleetLabor } = {}) {
  const c = FLEET_CLASSES.indexOf(vehicleClass);
  if (c < 0) throw new PricingError("Choose van/pickup, box truck, tractor, or trailer.");
  const svc = serviceById(serviceId);
  const r = RATES[serviceId];
  if (!svc || !r) throw new PricingError(`We can't price "${serviceId}" yet.`);
  const base = { serviceId, name: svc.name, vehicleClass };
  const notOffered = { ...base, offered: false, priceCents: null };
  const mk = 1 + s.fleetMk / 100;
  if (r.kind === "fleet") {
    const h = r.hours[c];
    if (h == null) return notOffered;
    const labor = cents(h * (r.wash ? s.fleetWash : laborRate));
    const parts = cents(r.parts[c] * mk);
    return { ...base, offered: true, hours: h, laborCents: labor, partsCostCents: cents(r.parts[c]), partsPriceCents: parts, priceCents: labor + parts };
  }
  if (r.kind === "book" && r.parts !== undefined) {
    if (vehicleClass === "trailer" && serviceId !== "brakes") return notOffered;
    const hours = roundHours(r.hours * FLEET_HOUR_FACTOR[c]);
    const partsCost = r.parts * FLEET_PARTS_FACTOR[c];
    const labor = cents(hours * laborRate);
    const parts = cents(partsCost * mk);
    return { ...base, offered: true, hours, laborCents: labor, partsCostCents: cents(partsCost), partsPriceCents: parts, priceCents: labor + parts };
  }
  return notOffered;
}

// What the customer pays for one visit (RULES.md, Pricing and Booking and payment).
// One mobile fee per visit no matter how many services; Plus waives mobile and protection fees.
export function customerTotal(lines, s, { mobile = true, plus = false, diagCredit = false, fleet = false } = {}) {
  const priced = lines.filter((l) => l.priceCents != null);
  const pending = lines.filter((l) => l.priceCents == null);
  const servicesCents = priced.reduce((a, l) => a + l.priceCents, 0);
  const fees = [];
  if (fleet) fees.push({ id: "trip", label: "Trip fee", cents: cents(s.fleetTrip) });
  else {
    if (mobile) fees.push({ id: "mobile", label: plus ? "Mobile service fee (Plus)" : "Mobile service fee", cents: plus ? 0 : cents(s.mobile) });
    fees.push({ id: "protection", label: plus ? "Service protection (Plus)" : "Service protection", cents: plus ? 0 : cents(s.protect) });
  }
  if (diagCredit) fees.push({ id: "diag_credit", label: "Diagnose It credit", cents: -cents(s.diag) });
  const totalCents = Math.max(0, servicesCents + fees.reduce((a, f) => a + f.cents, 0));
  const partsCostCents = priced.reduce((a, l) => a + (l.partsCostCents || 0), 0);
  // Jobs over the threshold take a deposit: a share of the total or the parts cost, whichever is higher.
  const depositCents = totalCents > cents(s.depositOver) ? Math.max(Math.round(totalCents * s.depositPct / 100), partsCostCents) : 0;
  const shopCents = priced.every((l) => l.shopPriceCents != null) && priced.length ? priced.reduce((a, l) => a + l.shopPriceCents, 0) : null;
  return {
    lines: priced, pending: pending.map((l) => ({ serviceId: l.serviceId, name: l.name, typicalCents: l.typicalCents || null, reason: l.fleetOnly ? "fleet_only" : "quote_needed" })),
    servicesCents, fees, totalCents, depositCents, holdCents: totalCents, holdHoursBefore: s.holdHrs,
    shopCompareCents: shopCents, savingsCents: shopCents != null ? shopCents - servicesCents : null,
  };
}

// What the partner earns for one visit (RULES.md, Partner pay).
// Labor minus the platform fee (taken from labor only) plus the mobile or trip fee, at least the minimum per visit.
// Parts are reimbursed at cost, apart from earnings.
export function partnerPay(lines, s, { mobile = true, fleet = false } = {}) {
  const priced = lines.filter((l) => l.priceCents != null);
  const laborCents = priced.reduce((a, l) => a + (l.laborCents || 0), 0);
  const feeCents = Math.round(laborCents * s.fee / 100);
  const visitFeeCents = fleet ? cents(s.fleetTrip) : mobile ? cents(s.mobile) : 0;
  const before = laborCents - feeCents + visitFeeCents;
  const topUpCents = Math.max(0, cents(s.minPay) - before);
  const partsReimbursedCents = priced.reduce((a, l) => a + (l.partsCostCents || 0), 0);
  const partsMarginCents = priced.reduce((a, l) => a + ((l.partsPriceCents || 0) - (l.partsCostCents || 0)), 0);
  return {
    laborCents, feePct: s.fee, feeCents, visitFeeCents, topUpCents, earningsCents: before + topUpCents, partsReimbursedCents,
    // What Auto-Auto keeps from the visit (the protection fee is separate and funds Partner Protection).
    platformCents: feeCents + partsMarginCents - topUpCents,
  };
}

// Helper for a quick look at a single service: customer price at home plus partner earnings for that one job.
export function menuItem(serviceId, vehicle, s) {
  const line = priceLine(serviceId, vehicle, s);
  if (line.priceCents == null) return { ...line, partnerEarnsCents: null };
  const pay = partnerPay([line], s, { mobile: true });
  return { ...line, partnerEarnsCents: pay.earningsCents };
}
