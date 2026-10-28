// Fleet (business) accounts (RULES.md, Fleet): vehicles with classes, multi-vehicle visits ("runs") that
// fleet-program partners claim, per-vehicle proof of work and maintenance logs, add-ons with an auto-approve
// limit, and one invoice per visit (net 30 after a credit check, or the card on file).
import { HttpError } from "../lib/http.js";
import { approvedProof, missingProof } from "../onboarding/proof.js";
import { newId } from "../auth/tokens.js";
import { US_STATES } from "../lib/validate.js";
import { serviceById, SERVICES } from "../catalog/services.js";
import { fleetLine, partnerPay, PricingError } from "../pricing/engine.js";
import { FLEET_CLASSES } from "../pricing/rates.js";
import { milesBetween, addressLine } from "../maps/geo.js";

const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;
const WINDOW_HOURS = 2;
const EARLIEST_HOURS = 2;
const LATEST_DAYS = 30;
const START_EARLY_HOURS = 3;
const FREE_CANCEL_HOURS = 24;
const NET_DAYS = 30;
const OIL_EVERY_MILES = 5000;
const MAX_VEHICLES_PER_RUN = 25;
const INSPECTION_ITEMS = ["brakes", "tires", "fluids", "battery", "wipers", "lights", "belts_hoses", "filters"];
export const CLASS_LABEL = { van_pickup: "Van or pickup", box_truck: "Box truck", tractor: "Tractor", trailer: "Trailer" };
const AUTO_APPROVE = [0, 5000, 7500, 10000, 15000];

const bad = (field, msg) => new HttpError(422, "invalid_input", "Some fields need fixing.", { fields: { [field]: msg } });
const conflict = (msg) => new HttpError(409, "wrong_step", msg);
const notFound = (what = "That") => new HttpError(404, "not_found", `${what} isn't on your account.`);
const J = (s, d) => (s ? JSON.parse(s) : d);
const text = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const cents = (d) => Math.round(d * 100);

export function createFleet({ db, settings, payments = null, photos = null, onboarding = null, geocode = null, notify = null, requirePhotos = false, now = () => Date.now(), log = () => {} }) {
  const tell = (uid, m) => (notify ? notify.send(db, uid, m).catch((e) => log(`[notify] ${e.message}`)) : null);
  const fmtMoney = (c) => `$${(c / 100).toFixed(2).replace(/\.00$/, "")}`;
  const settingsFor = async (v) => (await settings.version(v)).settings;
  const daysUntil = (date) => (date ? Math.floor((Date.parse(`${date}T12:00:00Z`) - now()) / DAY) : null);

  // Services a fleet can request: anything priced for at least one vehicle class.
  function fleetServices(s) {
    return SERVICES.filter((svc) => FLEET_CLASSES.some((c) => { try { return fleetLine(svc.id, c, s).offered; } catch { return false; } }))
      .map((svc) => ({ id: svc.id, name: svc.name, category: svc.category }));
  }

  function priceVehicle(v, serviceIds, s, laborRate) {
    const lines = [];
    const skipped = [];
    for (const id of serviceIds) {
      let l;
      try { l = fleetLine(id, v.vehicle_class, s, { laborRate }); } catch (e) { if (e instanceof PricingError) throw bad("serviceIds", e.message); throw e; }
      if (l.offered) lines.push(l); else skipped.push({ serviceId: id, name: l.name });
    }
    return { lines, skipped };
  }
  const sum = (lines) => lines.reduce((a, l) => a + (l.priceCents || 0), 0);

  function vehicleStatus(v) {
    const oilLeft = v.next_oil_miles != null && v.mileage != null ? v.next_oil_miles - v.mileage : null;
    const dot = daysUntil(v.dot_due);
    const over = (oilLeft != null && oilLeft < 0) || (dot != null && dot < 0);
    const due = (oilLeft != null && oilLeft <= 800) || (dot != null && dot <= 30);
    return over ? "overdue" : due ? "due" : "ok";
  }
  const vehicleOut = (v) => ({
    id: v.id, unit: v.unit, year: v.year, make: v.make, model: v.model, vehicleClass: v.vehicle_class, classLabel: CLASS_LABEL[v.vehicle_class],
    plate: v.plate, vin: v.vin, mileage: v.mileage, nextOilMiles: v.next_oil_miles, dotDue: v.dot_due, status: vehicleStatus(v),
  });

  // ---------- Accounts ----------
  async function myFleet(user, { required = true } = {}) {
    const f = await db.get(`SELECT * FROM fleets WHERE owner_id = $1`, [user.id]);
    if (!f && required) throw new HttpError(404, "no_fleet", "Create a business account first.");
    return f;
  }
  const fleetOut = (f) => ({
    id: f.id, name: f.name, managerName: f.manager_name, billingEmail: f.billing_email,
    yard: { street: f.yard_street, city: f.yard_city, state: f.yard_state, zip: f.yard_zip, onMap: f.lat != null }, yardHours: f.yard_hours, checkinNotes: f.checkin_notes,
    terms: f.terms, status: f.status, creditLimitCents: f.credit_limit_cents, laborRate: f.labor_rate, autoApproveCents: f.auto_approve_cents, poRequired: !!f.po_required,
    decisionNote: f.decision_note, createdAt: f.created_at,
  });

  function checkAccount(b, { partial = false } = {}) {
    const out = {};
    const need = (k, field, label, max, min = 1) => {
      if (partial && !(k in b)) return;
      const v = text(b[k], max);
      if (v.length < min) throw bad(field, label);
      out[k] = v;
    };
    need("name", "name", "Add your company name.", 100);
    need("managerName", "managerName", "Add the fleet manager's name.", 80);
    if (!partial || "billingEmail" in b) {
      const e = text(b.billingEmail, 120).toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw bad("billingEmail", "Add a billing email for invoices.");
      out.billingEmail = e;
    }
    need("yardStreet", "yardStreet", "Add the yard address where your vehicles are parked.", 120, 5);
    need("yardCity", "yardCity", "Add the yard's city.", 60);
    if (!partial || "yardState" in b) {
      const st = text(b.yardState, 2).toUpperCase();
      if (!US_STATES.has(st)) throw bad("yardState", "Use the 2-letter state code, like TN.");
      out.yardState = st;
    }
    if (!partial || "yardZip" in b) {
      const z = text(b.yardZip, 5);
      if (!/^\d{5}$/.test(z)) throw bad("yardZip", "ZIP must be 5 digits.");
      out.yardZip = z;
    }
    need("yardHours", "yardHours", "Add the yard hours so partners know when to come.", 80, 3);
    need("checkinNotes", "checkinNotes", "Tell partners where to check in and where the keys are.", 500, 10);
    if (!partial || "terms" in b) {
      if (!["net30", "card"].includes(b.terms)) throw bad("terms", "Choose net 30 invoices or card on file.");
      out.terms = b.terms;
    }
    if (!partial || "autoApproveCents" in b) {
      const a = Number(b.autoApproveCents ?? 0);
      if (!AUTO_APPROVE.includes(a)) throw bad("autoApproveCents", "Choose an auto-approve amount.");
      out.autoApproveCents = a;
    }
    if (!partial || "poRequired" in b) out.poRequired = b.poRequired === true;
    return out;
  }

  async function locateYard(f) {
    if (!geocode) return { lat: null, lng: null };
    const g = await geocode(addressLine({ street: f.yardStreet || f.yard_street, city: f.yardCity || f.yard_city, state: f.yardState || f.yard_state, zip: f.yardZip || f.yard_zip }));
    if (g.status === "not_found") throw bad("yardStreet", "We couldn't find that address on the map. Check the street and ZIP.");
    return g.status === "ok" ? { lat: g.lat, lng: g.lng } : { lat: null, lng: null };
  }

  // ---------- Runs ----------
  const runRow = (id) => db.get(`SELECT * FROM fleet_runs WHERE id = $1`, [String(id)]);
  const runVehicles = (runId) => db.all(
    `SELECT rv.*, v.unit, v.year, v.make, v.model, v.vehicle_class, v.plate, v.vin, v.mileage FROM fleet_run_vehicles rv JOIN fleet_vehicles v ON v.id = rv.vehicle_id WHERE rv.run_id = $1 ORDER BY v.unit`, [runId]);
  const addonsFor = (rvId) => db.all(`SELECT * FROM fleet_addons WHERE run_vehicle_id = $1 ORDER BY created_at`, [rvId]);
  const addonOut = (a) => ({ id: a.id, serviceId: a.service_id, name: J(a.line).name, priceCents: J(a.line).priceCents, reason: a.reason, status: a.status, autoApproved: !!a.auto_approved, createdAt: a.created_at });

  function cancelFee(run, s) {
    if (run.status === "claimed" && run.window_start - now() <= FREE_CANCEL_HOURS * HOUR) return cents(s.fleetTrip);
    return 0;
  }

  async function runOut(run, { forPartner = null, staff = false } = {}) {
    const f = await db.get(`SELECT * FROM fleets WHERE id = $1`, [run.fleet_id]);
    const s = await settingsFor(run.settings_version);
    const partner = run.partner_id ? await db.get(`SELECT id, first_name, last_name, phone FROM users WHERE id = $1`, [run.partner_id]) : null;
    const showWork = forPartner || staff || ["active", "completed"].includes(run.status);
    const vehicles = [];
    const allLines = [];
    for (const rv of await runVehicles(run.id)) {
      const lines = J(rv.lines, []);
      const raw = await addonsFor(rv.id);
      const addons = raw.map(addonOut);
      if (rv.status !== "skipped") allLines.push(...lines, ...raw.filter((a) => a.status === "approved").map((a) => J(a.line)));
      vehicles.push({
        id: rv.id, vehicleId: rv.vehicle_id, unit: rv.unit, year: rv.year, make: rv.make, model: rv.model, plate: rv.plate, vin: forPartner || staff ? rv.vin : undefined,
        vehicleClass: rv.vehicle_class, classLabel: CLASS_LABEL[rv.vehicle_class], status: rv.status,
        lines: lines.map((l) => ({ serviceId: l.serviceId, name: l.name, priceCents: l.priceCents, hours: l.hours, ...(forPartner || staff ? { partsCostCents: l.partsCostCents, laborCents: l.laborCents } : {}) })),
        skipped: J(rv.skipped_services, []), subtotalCents: sum(lines), addons,
        odometer: rv.odometer, inspection: J(rv.inspection), notes: rv.notes, skipReason: rv.skip_reason, doneAt: rv.done_at,
        photos: photos && showWork ? await photos.forOwner(db, "fleet", rv.id) : null,
      });
    }
    const inv = await db.get(`SELECT * FROM fleet_invoices WHERE run_id = $1 AND status <> 'void' ORDER BY issued_at DESC LIMIT 1`, [run.id]);
    const out = {
      id: run.id, number: run.number, status: run.status, windowStart: run.window_start, windowEnd: run.window_end, po: run.po,
      services: J(run.service_ids, []).map((x) => ({ id: x, name: (serviceById(x) || {}).name || x })),
      fleet: { id: f.id, name: f.name, yard: { street: f.yard_street, city: f.yard_city, state: f.yard_state, zip: f.yard_zip }, yardHours: f.yard_hours,
        ...(forPartner || staff ? { checkinNotes: f.checkin_notes, managerName: f.manager_name, autoApproveCents: f.auto_approve_cents } : {}) },
      partner: partner ? { id: partner.id, name: `${partner.first_name} ${partner.last_name ? `${partner.last_name[0]}.` : ""}`.trim() } : null,
      vehicles, tripFeeCents: cents(s.fleetTrip), estimateCents: run.estimate_cents, laborRate: run.labor_rate,
      invoice: inv ? { id: inv.id, number: inv.number, totalCents: inv.total_cents, status: inv.status, dueAt: inv.due_at } : null,
      cancelFeeCents: run.cancel_fee_cents, cancelReason: run.cancel_reason,
      cancelPreview: ["posted", "claimed"].includes(run.status) ? { feeCents: cancelFee(run, s) } : null,
      createdAt: run.created_at, claimedAt: run.claimed_at, startedAt: run.started_at, completedAt: run.completed_at, cancelledAt: run.cancelled_at,
    };
    if (forPartner) {
      const area = await db.get(`SELECT lat, lng FROM partner_service_areas WHERE user_id = $1`, [forPartner.id]);
      out.distanceMiles = f.lat != null && area && area.lat != null ? Math.round(milesBetween({ lat: f.lat, lng: f.lng }, area) * 10) / 10 : null;
      out.pay = run.partner_pay ? J(run.partner_pay) : partnerPay(allLines, s, { mobile: false, fleet: true });
      out.mine = run.partner_id === forPartner.id;
      out.canStartAt = run.window_start - START_EARLY_HOURS * HOUR;
      out.freeReleaseUntil = run.window_start - FREE_CANCEL_HOURS * HOUR;
      if (!out.mine) out.fleet.managerPhone = undefined;
      else {
        const owner = await db.get(`SELECT phone FROM users WHERE id = $1`, [f.owner_id]);
        out.fleet.managerPhone = owner && owner.phone;
      }
      out.photosRequired = !!(photos && requirePhotos);
    }
    return out;
  }

  // Partners who can do fleet work: active, insurance current, signed the Fleet Service Addendum.
  async function partnerProblem(user) {
    const p = await db.get(`SELECT status FROM partner_profiles WHERE user_id = $1`, [user.id]);
    if (!p || p.status !== "active") return "You can take fleet visits once your application is approved.";
    const lapsed = onboarding && (await onboarding.coverageProblem(user.id));
    if (lapsed) return lapsed;
    if (onboarding && !(await onboarding.hasSigned(user.id, "fleet"))) return "sign_addendum";
    return null;
  }

  async function partnerFits(user, run, f) {
    if (J(run.excluded_partners, []).includes(user.id)) return false;
    const offered = new Set((await db.all(`SELECT service_id FROM partner_services WHERE user_id = $1`, [user.id])).map((r) => r.service_id));
    const needed = new Set();
    for (const rv of await db.all(`SELECT lines FROM fleet_run_vehicles WHERE run_id = $1`, [run.id])) for (const l of J(rv.lines, [])) needed.add(l.serviceId);
    if (![...needed].every((x) => offered.has(x))) return false;
    // DOT, brake, glass, and wash work only once the partner's proof is approved.
    if (missingProof(await approvedProof(db, user.id), [...needed]).length) return false;
    if (f.lat == null) return true;
    const area = await db.get(`SELECT * FROM partner_service_areas WHERE user_id = $1`, [user.id]);
    if (!area || area.lat == null) return false;
    return milesBetween({ lat: f.lat, lng: f.lng }, area) <= area.radius_miles;
  }

  async function partnerRun(user, id, { mine = true } = {}) {
    const run = await runRow(id);
    if (!run || (mine && run.partner_id !== user.id)) throw notFound("That fleet visit");
    return run;
  }
  async function partnerRunVehicle(user, runId, rvId) {
    const run = await partnerRun(user, runId);
    const rv = await db.get(`SELECT * FROM fleet_run_vehicles WHERE id = $1 AND run_id = $2`, [String(rvId), run.id]);
    if (!rv) throw notFound("That vehicle");
    if (run.status !== "active") throw conflict("Start the fleet visit first.");
    return { run, rv };
  }

  async function nextNumber(t, table, start) {
    const r = await t.get(`SELECT MAX(number) AS n FROM ${table}`);
    return Math.max(Number(r.n || 0) + 1, start);
  }

  async function openInvoiceTotal(fleetId) {
    return Number((await db.get(`SELECT COALESCE(SUM(total_cents), 0) AS n FROM fleet_invoices WHERE fleet_id = $1 AND status = 'open'`, [fleetId])).n);
  }

  async function issueInvoice(t, f, run, lines) {
    const total = lines.reduce((a, l) => a + l.cents, 0);
    const number = await nextNumber(t, "fleet_invoices", 2001);
    const id = newId();
    const at = now();
    await t.run(
      `INSERT INTO fleet_invoices (id, number, fleet_id, run_id, po, lines, total_cents, status, issued_at, due_at) VALUES ($1, $2, $3, $4, $5, $6, $7, 'open', $8, $9)`,
      [id, number, f.id, run ? run.id : null, run ? run.po : null, JSON.stringify(lines), total, at, f.terms === "card" ? at : at + NET_DAYS * DAY],
    );
    return { id, number, total };
  }

  // Card-on-file fleets pay as soon as the invoice is issued.
  async function chargeIfCard(f, inv) {
    if (f.terms !== "card" || !payments || !payments.enabled || !inv.total) return;
    const r = await payments.chargeInvoice(f.owner_id, inv.total, { key: `fleet-invoice:${inv.id}`, description: `Auto-Auto invoice INV-${inv.number}`, metadata: { invoice_id: inv.id, fleet_id: f.id } });
    if (r.ok) await db.run(`UPDATE fleet_invoices SET status = 'paid', paid_at = $1, stripe_id = $2, paid_note = $3, payment_error = NULL WHERE id = $4`, [now(), r.stripeId, `Charged to ${r.card}`, inv.id]);
    else await db.run(`UPDATE fleet_invoices SET payment_error = $1 WHERE id = $2`, [r.message, inv.id]);
  }

  const invoiceOut = (i) => ({ id: i.id, number: i.number, runId: i.run_id, po: i.po, lines: J(i.lines, []), totalCents: i.total_cents, status: i.status, issuedAt: i.issued_at, dueAt: i.due_at, paidAt: i.paid_at, paidNote: i.paid_note, paymentError: i.payment_error, pastDue: i.status === "open" && now() > i.due_at });

  function checkInspection(ins) {
    if (!ins || typeof ins !== "object") throw bad("inspection", "Fill in the 8-item inspection report.");
    const clean = {};
    const missing = [];
    for (const k of INSPECTION_ITEMS) {
      const st = ins[k] && ins[k].status;
      if (!["good", "soon", "now"].includes(st)) { missing.push(k); continue; }
      const note = typeof ins[k].note === "string" ? ins[k].note.trim().slice(0, 200) : "";
      if (st !== "good" && note.length < 3) { missing.push(`${k} (add a note)`); continue; }
      clean[k] = { status: st, note: note || null };
    }
    if (missing.length) throw bad("inspection", `Finish the inspection report: ${missing.join(", ")}.`);
    return clean;
  }

  const api = {
    CLASS_LABEL,

    // ---------- Fleet manager (customer app) ----------
    async overview(user) {
      const f = await myFleet(user, { required: false });
      const s = (await settings.current()).settings;
      const base = { classes: Object.entries(CLASS_LABEL).map(([id, label]) => ({ id, label })), services: fleetServices(s), autoApproveChoices: AUTO_APPROVE,
        rates: { laborRate: f ? f.labor_rate : s.fleetLabor, partsMarkupPct: s.fleetMk, tripFeeCents: cents(s.fleetTrip), retailLaborRate: s.labor } };
      if (!f) return { fleet: null, ...base };
      const vehicles = (await db.all(`SELECT * FROM fleet_vehicles WHERE fleet_id = $1 AND archived_at IS NULL ORDER BY unit`, [f.id])).map(vehicleOut);
      const runs = await db.all(`SELECT * FROM fleet_runs WHERE fleet_id = $1 ORDER BY CASE WHEN status IN ('completed','cancelled') THEN 1 ELSE 0 END, window_start DESC LIMIT 100`, [f.id]);
      const counts = new Map((await db.all(`SELECT run_id, COUNT(*) AS n, SUM(CASE WHEN status IN ('done','skipped') THEN 1 ELSE 0 END) AS d FROM fleet_run_vehicles GROUP BY run_id`)).map((r) => [r.run_id, r]));
      const invoices = (await db.all(`SELECT * FROM fleet_invoices WHERE fleet_id = $1 AND status <> 'void' ORDER BY issued_at DESC LIMIT 100`, [f.id])).map(invoiceOut);
      const approvals = await db.all(
        `SELECT a.*, v.unit, r.id AS run_id, r.number FROM fleet_addons a JOIN fleet_run_vehicles rv ON rv.id = a.run_vehicle_id JOIN fleet_vehicles v ON v.id = rv.vehicle_id JOIN fleet_runs r ON r.id = rv.run_id WHERE r.fleet_id = $1 ORDER BY a.created_at DESC LIMIT 50`, [f.id]);
      const open = await openInvoiceTotal(f.id);
      return {
        ...base, fleet: fleetOut(f), vehicles,
        runs: await Promise.all(runs.map(async (r) => {
          const p = r.partner_id ? await db.get(`SELECT first_name, last_name FROM users WHERE id = $1`, [r.partner_id]) : null;
          const c = counts.get(r.id) || { n: 0, d: 0 };
          return { id: r.id, number: r.number, status: r.status, windowStart: r.window_start, po: r.po, vehicles: Number(c.n), done: Number(c.d), estimateCents: r.estimate_cents,
            services: J(r.service_ids, []).map((x) => (serviceById(x) || {}).name || x), partner: p ? `${p.first_name} ${p.last_name ? `${p.last_name[0]}.` : ""}`.trim() : null };
        })),
        approvals: approvals.map((a) => ({ ...addonOut(a), unit: a.unit, runId: a.run_id, runNumber: a.number })),
        invoices, openInvoicesCents: open,
        creditAvailableCents: f.terms === "net30" ? Math.max(0, f.credit_limit_cents - open) : null,
        hasCard: payments && payments.enabled ? await payments.hasCard(user.id) : null,
      };
    },

    async create(user, b) {
      if (await myFleet(user, { required: false })) throw conflict("You already have a business account.");
      const v = checkAccount(b);
      const s = (await settings.current()).settings;
      const where = await locateYard(v);
      const id = newId();
      const at = now();
      // Card on file starts right away; net 30 waits for a credit check by staff.
      const status = v.terms === "card" ? "active" : "review";
      await db.run(
        `INSERT INTO fleets (id, owner_id, name, manager_name, billing_email, yard_street, yard_city, yard_state, yard_zip, lat, lng, yard_hours, checkin_notes, terms, status, credit_limit_cents, labor_rate, auto_approve_cents, po_required, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 0, $16, $17, $18, $19, $19)`,
        [id, user.id, v.name, v.managerName, v.billingEmail, v.yardStreet, v.yardCity, v.yardState, v.yardZip, where.lat, where.lng, v.yardHours, v.checkinNotes, v.terms, status, s.fleetLabor, v.autoApproveCents, v.poRequired ? 1 : 0, at],
      );
      return api.overview(user);
    },

    async update(user, b) {
      const f = await myFleet(user);
      const v = checkAccount(b, { partial: true });
      const cols = { name: "name", managerName: "manager_name", billingEmail: "billing_email", yardStreet: "yard_street", yardCity: "yard_city", yardState: "yard_state", yardZip: "yard_zip", yardHours: "yard_hours", checkinNotes: "checkin_notes", autoApproveCents: "auto_approve_cents", poRequired: "po_required", terms: "terms" };
      const set = {};
      for (const [k, col] of Object.entries(cols)) if (k in v) set[col] = k === "poRequired" ? (v[k] ? 1 : 0) : v[k];
      if (["yardStreet", "yardCity", "yardState", "yardZip"].some((k) => k in v)) {
        const where = await locateYard({ yardStreet: v.yardStreet || f.yard_street, yardCity: v.yardCity || f.yard_city, yardState: v.yardState || f.yard_state, yardZip: v.yardZip || f.yard_zip });
        Object.assign(set, where);
      }
      // Switching to card on file starts right away. Switching to net 30 needs a credit check.
      if ("terms" in v && v.terms !== f.terms) set.status = v.terms === "card" ? (f.status === "paused" ? "paused" : "active") : "review";
      const keys = Object.keys(set);
      if (keys.length) await db.run(`UPDATE fleets SET ${keys.map((k, i) => `${k} = $${i + 1}`).join(", ")}, updated_at = $${keys.length + 1} WHERE id = $${keys.length + 2}`, [...keys.map((k) => set[k]), now(), f.id]);
      return api.overview(user);
    },

    async addVehicle(user, b) {
      const f = await myFleet(user);
      const n = Number((await db.get(`SELECT COUNT(*) AS n FROM fleet_vehicles WHERE fleet_id = $1 AND archived_at IS NULL`, [f.id])).n);
      if (n >= 500) throw bad("unit", "You can have up to 500 vehicles. Contact us for more.");
      const v = checkVehicle(b);
      if (await db.get(`SELECT id FROM fleet_vehicles WHERE fleet_id = $1 AND archived_at IS NULL AND LOWER(unit) = LOWER($2)`, [f.id, v.unit])) throw bad("unit", "You already have a vehicle with that unit number.");
      const at = now();
      await db.run(
        `INSERT INTO fleet_vehicles (id, fleet_id, unit, year, make, model, vehicle_class, plate, vin, mileage, next_oil_miles, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12)`,
        [newId(), f.id, v.unit, v.year, v.make, v.model, v.vehicleClass, v.plate, v.vin, v.mileage, v.mileage != null ? v.mileage + OIL_EVERY_MILES : null, at],
      );
      return api.overview(user);
    },
    async updateVehicle(user, id, b) {
      const f = await myFleet(user);
      const cur = await db.get(`SELECT * FROM fleet_vehicles WHERE id = $1 AND fleet_id = $2 AND archived_at IS NULL`, [String(id), f.id]);
      if (!cur) throw notFound("That vehicle");
      const v = checkVehicle({ unit: cur.unit, year: cur.year, make: cur.make, model: cur.model, vehicleClass: cur.vehicle_class, plate: cur.plate, vin: cur.vin, mileage: cur.mileage, ...b });
      await db.run(`UPDATE fleet_vehicles SET unit = $1, year = $2, make = $3, model = $4, vehicle_class = $5, plate = $6, vin = $7, mileage = $8, updated_at = $9 WHERE id = $10`,
        [v.unit, v.year, v.make, v.model, v.vehicleClass, v.plate, v.vin, v.mileage, now(), cur.id]);
      return api.overview(user);
    },
    async removeVehicle(user, id) {
      const f = await myFleet(user);
      const busy = await db.get(`SELECT rv.id FROM fleet_run_vehicles rv JOIN fleet_runs r ON r.id = rv.run_id WHERE rv.vehicle_id = $1 AND r.status IN ('posted','claimed','active')`, [String(id)]);
      if (busy) throw conflict("This vehicle is on an upcoming visit. Cancel the visit or remove the vehicle from it first.");
      const r = await db.run(`UPDATE fleet_vehicles SET archived_at = $1 WHERE id = $2 AND fleet_id = $3 AND archived_at IS NULL`, [now(), String(id), f.id]);
      if (!r.changes) throw notFound("That vehicle");
      return api.overview(user);
    },

    // Maintenance log for one vehicle: every visit with mileage, work, inspection, notes, and photos.
    async vehicleLog(user, id) {
      const f = await myFleet(user);
      const v = await db.get(`SELECT * FROM fleet_vehicles WHERE id = $1 AND fleet_id = $2`, [String(id), f.id]);
      if (!v) throw notFound("That vehicle");
      return api.logFor(v, f);
    },
    async logFor(v) {
      const rows = await db.all(
        `SELECT rv.*, r.number, r.partner_id, r.po FROM fleet_run_vehicles rv JOIN fleet_runs r ON r.id = rv.run_id WHERE rv.vehicle_id = $1 AND rv.status = 'done' ORDER BY rv.done_at DESC LIMIT 100`, [v.id]);
      const entries = [];
      for (const r of rows) {
        const p = r.partner_id ? await db.get(`SELECT first_name, last_name FROM users WHERE id = $1`, [r.partner_id]) : null;
        const addons = (await addonsFor(r.id)).filter((a) => a.status === "approved").map((a) => J(a.line).name);
        entries.push({
          runVehicleId: r.id, runNumber: r.number, po: r.po, doneAt: r.done_at, odometer: r.odometer,
          services: [...J(r.lines, []).map((l) => l.name), ...addons], inspection: J(r.inspection), notes: r.notes,
          partner: p ? `${p.first_name} ${p.last_name ? `${p.last_name[0]}.` : ""}`.trim() : null,
          photos: photos ? await photos.forOwner(db, "fleet", r.id) : null,
        });
      }
      return { vehicle: vehicleOut(v), entries };
    },

    async estimate(user, b) {
      const f = await myFleet(user);
      const { vehicles, serviceIds } = await checkRunPicks(f, b);
      const s = (await settings.current()).settings;
      const est = estimateFor(vehicles, serviceIds, s, f.labor_rate);
      // Fleet managers see prices, not what parts cost the partner.
      return { ...est, vehicles: est.vehicles.map((v) => ({ ...v, lines: v.lines.map((l) => ({ serviceId: l.serviceId, name: l.name, hours: l.hours, priceCents: l.priceCents })) })) };
    },

    async postRun(user, b) {
      const f = await myFleet(user);
      if (f.status !== "active") throw conflict(f.status === "review" ? "Your account is waiting for its credit check. Switch to card on file to start today." : "Your business account isn't active. Contact support.");
      const { vehicles, serviceIds } = await checkRunPicks(f, b);
      const start = typeof b.windowStart === "number" ? b.windowStart : Date.parse(b.windowStart);
      if (!Number.isFinite(start)) throw bad("windowStart", "Pick a day and arrival window.");
      if (start < now() + EARLIEST_HOURS * HOUR) throw bad("windowStart", `Pick a time at least ${EARLIEST_HOURS} hours from now.`);
      if (start > now() + LATEST_DAYS * DAY) throw bad("windowStart", `You can book up to ${LATEST_DAYS} days ahead.`);
      const po = text(b.po, 40) || null;
      if (f.po_required && !po) throw bad("po", "Your account requires a PO number.");
      const cur = await settings.current();
      const est = estimateFor(vehicles, serviceIds, cur.settings, f.labor_rate);
      if (!est.vehicles.some((v) => v.lines.length)) throw bad("serviceIds", "None of those services fit the vehicles you picked.");
      if (f.terms === "net30") {
        const open = await openInvoiceTotal(f.id);
        if (open + est.totalCents > f.credit_limit_cents) throw conflict(`This visit would go over your credit limit (${(f.credit_limit_cents / 100).toFixed(2)} with ${(open / 100).toFixed(2)} in open invoices). Pay an invoice or contact us to raise it.`);
      } else if (payments && payments.enabled && !(await payments.hasCard(user.id))) {
        throw new HttpError(422, "card_required", "Add a card before requesting service. It's charged when each visit's invoice is issued.", { fields: { card: "Add a card." } });
      }
      const id = newId();
      await db.tx(async (t) => {
        const number = await nextNumber(t, "fleet_runs", 1001);
        await t.run(
          `INSERT INTO fleet_runs (id, number, fleet_id, status, window_start, window_end, po, service_ids, settings_version, labor_rate, estimate_cents, created_at, updated_at)
           VALUES ($1, $2, $3, 'posted', $4, $5, $6, $7, $8, $9, $10, $11, $11)`,
          [id, number, f.id, start, start + WINDOW_HOURS * HOUR, po, JSON.stringify(serviceIds), cur.version, f.labor_rate, est.totalCents, now()],
        );
        for (const v of est.vehicles) {
          if (!v.lines.length) continue;
          await t.run(`INSERT INTO fleet_run_vehicles (id, run_id, vehicle_id, status, lines, skipped_services) VALUES ($1, $2, $3, 'scheduled', $4, $5)`,
            [newId(), id, v.vehicleId, JSON.stringify(v.lines), JSON.stringify(v.skipped)]);
        }
      });
      return runOut(await runRow(id));
    },

    async getRun(user, id) {
      const f = await myFleet(user);
      const run = await runRow(id);
      if (!run || run.fleet_id !== f.id) throw notFound("That visit");
      return runOut(run);
    },

    async cancelRun(user, id, b) {
      const f = await myFleet(user);
      const run = await runRow(id);
      if (!run || run.fleet_id !== f.id) throw notFound("That visit");
      if (!["posted", "claimed"].includes(run.status)) throw conflict(run.status === "active" ? "Your partner already started. Talk to them, or contact support." : "This visit can't be cancelled.");
      const s = await settingsFor(run.settings_version);
      const fee = cancelFee(run, s);
      if (b.expectedFeeCents != null && Number(b.expectedFeeCents) !== fee) throw conflict("The cancellation fee changed while you were deciding. Check the new amount and try again.");
      let inv = null;
      await db.tx(async (t) => {
        await t.run(`UPDATE fleet_runs SET status = 'cancelled', cancelled_at = $1, cancel_fee_cents = $2, cancel_reason = $3, updated_at = $1 WHERE id = $4`, [now(), fee, text(b.reason, 200) || null, run.id]);
        if (fee) inv = await issueInvoice(t, f, run, [{ label: "Late cancellation (trip fee)", cents: fee }]);
      });
      // The partner was already planning the trip: the fee is theirs.
      if (fee && run.partner_id && payments) await payments.creditPartner(run.partner_id, "fee_share", fee, `Fleet visit #${run.number} cancelled late`);
      if (inv) await chargeIfCard(f, inv);
      return runOut(await runRow(run.id));
    },

    async decideAddon(user, addonId, approve) {
      const f = await myFleet(user);
      const a = await db.get(`SELECT a.*, r.fleet_id, r.status AS run_status FROM fleet_addons a JOIN fleet_run_vehicles rv ON rv.id = a.run_vehicle_id JOIN fleet_runs r ON r.id = rv.run_id WHERE a.id = $1`, [String(addonId)]);
      if (!a || a.fleet_id !== f.id) throw notFound("That add-on");
      if (a.status !== "pending") throw conflict("You already answered this request.");
      if (a.run_status !== "active") throw conflict("This visit isn't in progress anymore.");
      await db.run(`UPDATE fleet_addons SET status = $1, decided_at = $2 WHERE id = $3`, [approve ? "approved" : "declined", now(), a.id]);
      return api.overview(user);
    },

    async invoice(user, id) {
      const f = await myFleet(user);
      const i = await db.get(`SELECT * FROM fleet_invoices WHERE id = $1 AND fleet_id = $2`, [String(id), f.id]);
      if (!i) throw notFound("That invoice");
      return { ...invoiceOut(i), fleet: { name: f.name, billingEmail: f.billing_email, terms: f.terms } };
    },
    async payInvoice(user, id) {
      const f = await myFleet(user);
      const i = await db.get(`SELECT * FROM fleet_invoices WHERE id = $1 AND fleet_id = $2`, [String(id), f.id]);
      if (!i) throw notFound("That invoice");
      if (i.status !== "open") throw conflict("This invoice is already paid.");
      if (!payments || !payments.enabled) throw new HttpError(503, "payments_off", "Card payments aren't turned on yet. Pay by check or ACH using the details on the invoice.");
      const r = await payments.chargeInvoice(user.id, i.total_cents, { key: `fleet-invoice:${i.id}:${i.payment_error ? now() : "first"}`, description: `Auto-Auto invoice INV-${i.number}`, metadata: { invoice_id: i.id, fleet_id: f.id } });
      if (!r.ok) {
        await db.run(`UPDATE fleet_invoices SET payment_error = $1 WHERE id = $2`, [r.message, i.id]);
        throw new HttpError(402, "card_declined", r.message);
      }
      await db.run(`UPDATE fleet_invoices SET status = 'paid', paid_at = $1, stripe_id = $2, paid_note = $3, payment_error = NULL WHERE id = $4`, [now(), r.stripeId, `Paid by ${r.card}`, i.id]);
      return api.invoice(user, i.id);
    },

    // ---------- Partners (fleet program) ----------
    async partnerHome(user) {
      const problem = await partnerProblem(user);
      const base = { enrolled: problem !== "sign_addendum" && !problem, problem: problem === "sign_addendum" ? null : problem, needsAddendum: problem === "sign_addendum" };
      const mineRows = await db.all(`SELECT * FROM fleet_runs WHERE partner_id = $1 AND status IN ('claimed','active') ORDER BY window_start`, [user.id]);
      const doneRows = await db.all(`SELECT * FROM fleet_runs WHERE partner_id = $1 AND status = 'completed' ORDER BY completed_at DESC LIMIT 10`, [user.id]);
      let open = [];
      if (!problem) {
        const rows = await db.all(`SELECT r.* FROM fleet_runs r JOIN fleets f ON f.id = r.fleet_id WHERE r.status = 'posted' AND r.window_start > $1 ORDER BY r.window_start LIMIT 100`, [now()]);
        for (const r of rows) {
          const f = await db.get(`SELECT * FROM fleets WHERE id = $1`, [r.fleet_id]);
          if (await partnerFits(user, r, f)) open.push(r);
        }
      }
      const short = async (r) => { const o = await runOut(r, { forPartner: user }); return { ...o, vehicles: o.vehicles.map((v) => ({ id: v.id, unit: v.unit, make: v.make, model: v.model, status: v.status, lines: v.lines })) }; };
      open = await Promise.all(open.slice(0, 30).map(short));
      return { ...base, open, mine: await Promise.all(mineRows.map(short)), done: await Promise.all(doneRows.map(short)) };
    },

    async partnerGetRun(user, id) {
      const run = await partnerRun(user, id, { mine: false });
      if (run.partner_id !== user.id) {
        if (run.status !== "posted" || (await partnerProblem(user))) throw notFound("That fleet visit");
      }
      return runOut(run, { forPartner: user });
    },

    async claim(user, id) {
      const problem = await partnerProblem(user);
      if (problem) throw new HttpError(403, "not_eligible", problem === "sign_addendum" ? "Sign the Fleet Service Addendum to take fleet visits." : problem);
      const run = await partnerRun(user, id, { mine: false });
      const f = await db.get(`SELECT * FROM fleets WHERE id = $1`, [run.fleet_id]);
      if (run.status !== "posted") throw conflict("Another partner already took this visit.");
      if (!(await partnerFits(user, run, f))) throw conflict("You don't offer every service on this visit, or the yard is outside your service area.");
      const r = await db.run(`UPDATE fleet_runs SET status = 'claimed', partner_id = $1, claimed_at = $2, updated_at = $2 WHERE id = $3 AND status = 'posted'`, [user.id, now(), run.id]);
      if (!r.changes) throw conflict("Another partner already took this visit.");
      const who = await db.get(`SELECT first_name FROM users WHERE id = $1`, [user.id]);
      await tell(f.owner_id, { category: "booking", title: `Fleet visit #${run.number} confirmed`, body: `${who.first_name} will service your vehicles at the yard on ${new Date(run.window_start).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" })}.`, data: { route: "/fleet-run", params: { id: run.id } } });
      return runOut(await runRow(run.id), { forPartner: user });
    },

    async release(user, id) {
      const run = await partnerRun(user, id);
      if (run.status !== "claimed") throw conflict(run.status === "active" ? "You already started. Finish the vehicles you can, or contact partner support." : "This visit can't be released.");
      const late = run.window_start - now() <= FREE_CANCEL_HOURS * HOUR;
      const ex = J(run.excluded_partners, []);
      ex.push(user.id);
      await db.run(`UPDATE fleet_runs SET status = 'posted', partner_id = NULL, claimed_at = NULL, excluded_partners = $1, updated_at = $2 WHERE id = $3`, [JSON.stringify(ex), now(), run.id]);
      if (late) {
        const n = Number((await db.get(`SELECT COUNT(*) AS n FROM auth_events WHERE user_id = $1 AND kind = 'fleet_late_release' AND created_at > $2`, [user.id, now() - 30 * DAY])).n) + 1;
        await db.run(`INSERT INTO auth_events (id, user_id, kind, ip, created_at) VALUES ($1, $2, 'fleet_late_release', NULL, $3)`, [newId(), user.id, now()]);
        if (n >= 3) await db.run(`UPDATE partner_profiles SET review_reason = $1, updated_at = $2 WHERE user_id = $3`, [`${n} late fleet releases in 30 days`, now(), user.id]);
      }
      return { ok: true, late };
    },

    async start(user, id) {
      const run = await partnerRun(user, id);
      if (run.status !== "claimed") throw conflict("You can start a fleet visit you've claimed.");
      if (now() < run.window_start - START_EARLY_HOURS * HOUR) throw conflict(`You can start up to ${START_EARLY_HOURS} hours before the arrival window.`);
      const lapsed = onboarding && (await onboarding.coverageProblem(user.id));
      if (lapsed) throw new HttpError(403, "coverage_lapsed", lapsed);
      await db.tx(async (t) => {
        await t.run(`UPDATE fleet_runs SET status = 'active', started_at = $1, updated_at = $1 WHERE id = $2`, [now(), run.id]);
        await t.run(`UPDATE fleet_run_vehicles SET status = 'checkin' WHERE run_id = $1 AND status = 'scheduled'`, [run.id]);
      });
      return runOut(await runRow(run.id), { forPartner: user });
    },

    async photo(user, runId, rvId, b) {
      const { rv } = await partnerRunVehicle(user, runId, rvId);
      return photos.saveSlot("fleet", rv.id, user, b, {
        allow: (kind) => {
          if (kind === "checkin" && rv.status !== "checkin") throw conflict(rv.status === "service" ? "Check-in photos are locked once work starts on this vehicle." : "This vehicle isn't at check-in.");
          if (kind === "after" && rv.status !== "service") throw conflict("Take after photos while you're working on this vehicle.");
        },
      });
    },
    async damage(user, runId, rvId, slot, b) {
      const { rv } = await partnerRunVehicle(user, runId, rvId);
      if (rv.status !== "checkin") throw conflict("Damage notes are part of check-in, before work starts.");
      return photos.setDamage("fleet", rv.id, slot, b);
    },

    async checkIn(user, runId, rvId, b) {
      const { run, rv } = await partnerRunVehicle(user, runId, rvId);
      if (rv.status !== "checkin") throw conflict("This vehicle is already checked in.");
      const odo = typeof b.odometer === "number" ? b.odometer : Number(String(b.odometer ?? "").replace(/[,\s]/g, ""));
      if (!Number.isInteger(odo) || odo < 0 || odo > 3_000_000) throw bad("odometer", "Enter the odometer reading as a whole number of miles.");
      if (photos && requirePhotos) {
        const missing = await photos.missing(rv.id, "checkin", "fleet");
        if (missing) throw conflict(`Take all 12 check-in photos before starting work. Still needed: ${missing.join(", ")}.`);
      }
      await db.run(`UPDATE fleet_run_vehicles SET status = 'service', odometer = $1 WHERE id = $2`, [odo, rv.id]);
      return runOut(await runRow(run.id), { forPartner: user });
    },

    // Add-ons up to the fleet's limit per vehicle are approved on the spot; anything more waits for the manager.
    async requestAddons(user, runId, rvId, b) {
      const { run, rv } = await partnerRunVehicle(user, runId, rvId);
      if (rv.status !== "service") throw conflict("Add-ons can be requested once the vehicle is checked in.");
      const ids = Array.isArray(b.serviceIds) ? [...new Set(b.serviceIds.map(String))] : [];
      if (!ids.length || ids.length > 5) throw bad("serviceIds", "Pick up to 5 services to add.");
      const reason = text(b.reason, 300);
      if (reason.length < 5) throw bad("reason", "Tell the fleet manager what you found and why it needs doing.");
      const f = await db.get(`SELECT * FROM fleets WHERE id = $1`, [run.fleet_id]);
      const v = await db.get(`SELECT * FROM fleet_vehicles WHERE id = $1`, [rv.vehicle_id]);
      const s = await settingsFor(run.settings_version);
      const have = new Set([...J(rv.lines, []).map((l) => l.serviceId), ...(await addonsFor(rv.id)).filter((a) => a.status !== "declined").map((a) => a.service_id)]);
      let approvedSoFar = (await addonsFor(rv.id)).filter((a) => a.status === "approved").reduce((x, a) => x + J(a.line).priceCents, 0);
      for (const id of ids) {
        if (have.has(id)) throw bad("serviceIds", `${(serviceById(id) || {}).name || id} is already on this vehicle.`);
        let line;
        try { line = fleetLine(id, v.vehicle_class, s, { laborRate: run.labor_rate }); } catch (e) { if (e instanceof PricingError) throw bad("serviceIds", e.message); throw e; }
        if (!line.offered) throw bad("serviceIds", `${line.name} isn't offered for a ${CLASS_LABEL[v.vehicle_class].toLowerCase()}.`);
        const auto = approvedSoFar + line.priceCents <= f.auto_approve_cents;
        if (auto) approvedSoFar += line.priceCents;
        await db.run(`INSERT INTO fleet_addons (id, run_vehicle_id, service_id, reason, line, status, auto_approved, created_at, decided_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [newId(), rv.id, id, reason, JSON.stringify(line), auto ? "approved" : "pending", auto ? 1 : 0, now(), auto ? now() : null]);
        if (!auto) await tell(f.owner_id, { category: "addons", title: `Approve work on ${v.unit}?`, body: `"${reason.slice(0, 120)}" ${line.name} for ${fmtMoney(line.priceCents)}. It's above your auto-approve limit, so it waits for you.`, data: { route: "/fleet-run", params: { id: run.id } } });
      }
      return runOut(await runRow(run.id), { forPartner: user });
    },

    async vehicleDone(user, runId, rvId, b) {
      const { run, rv } = await partnerRunVehicle(user, runId, rvId);
      if (rv.status !== "service") throw conflict("Check in this vehicle before finishing it.");
      if ((await addonsFor(rv.id)).some((a) => a.status === "pending")) throw conflict("An add-on is waiting for the fleet manager. Wait for their answer before finishing this vehicle.");
      if (photos && requirePhotos) {
        const missing = await photos.missing(rv.id, "after", "fleet");
        if (missing) throw conflict(`Take both after photos before finishing. Still needed: ${missing.join(", ")}.`);
      }
      const inspection = checkInspection(b.inspection);
      const notes = text(b.notes, 1000);
      if (notes.length < 10) throw bad("notes", "Add a short note for the fleet's maintenance log (work done, anything due next).");
      await db.run(`UPDATE fleet_run_vehicles SET status = 'done', inspection = $1, notes = $2, done_at = $3 WHERE id = $4`, [JSON.stringify(inspection), notes, now(), rv.id]);
      return runOut(await runRow(run.id), { forPartner: user });
    },

    async skipVehicle(user, runId, rvId, b) {
      const { run, rv } = await partnerRunVehicle(user, runId, rvId);
      if (!["checkin", "service"].includes(rv.status)) throw conflict("This vehicle is already finished.");
      const reason = text(b.reason, 200);
      if (reason.length < 5) throw bad("reason", "Say why (for example: not in the yard, or not safe to work on).");
      await db.run(`UPDATE fleet_run_vehicles SET status = 'skipped', skip_reason = $1, done_at = $2 WHERE id = $3`, [reason, now(), rv.id]);
      await db.run(`UPDATE fleet_addons SET status = 'declined', decided_at = $1 WHERE run_vehicle_id = $2 AND status = 'pending'`, [now(), rv.id]);
      return runOut(await runRow(run.id), { forPartner: user });
    },

    // Finishing the visit: one invoice for the fleet, pay for the partner, and each vehicle's log and mileage updated.
    async finish(user, id) {
      const run = await partnerRun(user, id);
      if (run.status !== "active") throw conflict("Start the visit first.");
      const rvs = await runVehicles(run.id);
      const open = rvs.filter((x) => !["done", "skipped"].includes(x.status));
      if (open.length) throw conflict(`Finish or skip every vehicle first: ${open.map((x) => x.unit).join(", ")}.`);
      if (!rvs.some((x) => x.status === "done")) throw conflict("No vehicles were serviced. Release or contact support instead.");
      const f = await db.get(`SELECT * FROM fleets WHERE id = $1`, [run.fleet_id]);
      const s = await settingsFor(run.settings_version);
      const invLines = [];
      const payLines = [];
      for (const rv of rvs.filter((x) => x.status === "done")) {
        const lines = J(rv.lines, []);
        const extra = (await addonsFor(rv.id)).filter((a) => a.status === "approved").map((a) => J(a.line));
        payLines.push(...lines, ...extra);
        invLines.push({ label: `${rv.unit} · ${lines.map((l) => l.name).join(", ")}`, cents: sum(lines), vehicleId: rv.vehicle_id });
        for (const a of extra) invLines.push({ label: `${rv.unit} · Add-on: ${a.name}`, cents: a.priceCents, vehicleId: rv.vehicle_id });
        // Mileage and what's due next.
        const v = await db.get(`SELECT * FROM fleet_vehicles WHERE id = $1`, [rv.vehicle_id]);
        const all = [...lines, ...extra].map((l) => l.serviceId);
        const set = { mileage: Math.max(v.mileage || 0, rv.odometer || 0) };
        if (all.includes("oil_change") && rv.odometer != null) set.next_oil_miles = rv.odometer + OIL_EVERY_MILES;
        if (all.includes("dot_annual")) { const d = new Date(now()); d.setUTCFullYear(d.getUTCFullYear() + 1); set.dot_due = d.toISOString().slice(0, 10); }
        const keys = Object.keys(set);
        await db.run(`UPDATE fleet_vehicles SET ${keys.map((k, i) => `${k} = $${i + 1}`).join(", ")}, updated_at = $${keys.length + 1} WHERE id = $${keys.length + 2}`, [...keys.map((k) => set[k]), now(), v.id]);
      }
      invLines.push({ label: "Trip fee (one per visit)", cents: cents(s.fleetTrip) });
      const pay = partnerPay(payLines, s, { mobile: false, fleet: true });
      let inv;
      await db.tx(async (t) => {
        const r = await t.run(`UPDATE fleet_runs SET status = 'completed', completed_at = $1, partner_pay = $2, updated_at = $1 WHERE id = $3 AND status = 'active'`, [now(), JSON.stringify(pay), run.id]);
        if (!r.changes) throw conflict("This visit was already finished.");
        inv = await issueInvoice(t, f, run, invLines);
      });
      // Partners are paid on their normal schedule whether or not the fleet has paid (RULES.md, Fleet).
      if (payments) {
        await payments.creditPartner(user.id, "earnings", pay.earningsCents, `Fleet visit #${run.number} · ${f.name}`);
        await payments.creditPartner(user.id, "parts", pay.partsReimbursedCents, `Fleet visit #${run.number} parts at cost`);
      }
      await chargeIfCard(f, inv);
      const paid = await db.get(`SELECT status FROM fleet_invoices WHERE id = $1`, [inv.id]);
      await tell(f.owner_id, {
        category: "receipts", title: `Invoice INV-${inv.number}: ${fmtMoney(inv.total)}`,
        body: `Fleet visit #${run.number} is done. ${paid && paid.status === "paid" ? "Charged to your card on file." : f.terms === "net30" ? "Due in 30 days." : "Open the invoice in the app to pay."}`,
        data: { route: "/fleet-invoice", params: { id: inv.id } },
        emailText: `Fleet visit #${run.number} at ${f.name} is done.\n\n${invLines.map((l) => `${l.label}: ${fmtMoney(l.cents)}`).join("\n")}\n\nInvoice INV-${inv.number}${run.po ? ` · PO ${run.po}` : ""}.`,
      });
      log(`[fleet] visit #${run.number} finished; invoice INV-${inv.number}`);
      return runOut(await runRow(run.id), { forPartner: user });
    },

    // ---------- Staff ----------
    async staffList() {
      const rows = await db.all(`SELECT f.*, u.email AS owner_email FROM fleets f JOIN users u ON u.id = f.owner_id ORDER BY CASE f.status WHEN 'review' THEN 0 ELSE 1 END, f.created_at DESC`);
      const out = [];
      for (const f of rows) {
        const vehicles = Number((await db.get(`SELECT COUNT(*) AS n FROM fleet_vehicles WHERE fleet_id = $1 AND archived_at IS NULL`, [f.id])).n);
        const open = await openInvoiceTotal(f.id);
        const pastDue = Number((await db.get(`SELECT COALESCE(SUM(total_cents), 0) AS n FROM fleet_invoices WHERE fleet_id = $1 AND status = 'open' AND due_at < $2`, [f.id, now()])).n);
        out.push({ ...fleetOut(f), ownerEmail: f.owner_email, vehicles, openInvoicesCents: open, pastDueCents: pastDue });
      }
      return out;
    },
    async staffDecide(staff, id, b) {
      const f = await db.get(`SELECT * FROM fleets WHERE id = $1`, [String(id)]);
      if (!f) throw new HttpError(404, "not_found", "No fleet with that ID.");
      const note = text(b.note, 500);
      const set = {};
      if (b.laborRate != null) {
        const r = Number(b.laborRate);
        if (!(r > 0 && r <= 500)) throw bad("laborRate", "Labor rate must be between $1 and $500 an hour.");
        set.labor_rate = r;
      }
      if (b.creditLimitCents != null) {
        const c = Number(b.creditLimitCents);
        if (!Number.isInteger(c) || c < 0 || c > 100_000_000) throw bad("creditLimitCents", "Enter the credit limit in cents.");
        set.credit_limit_cents = c;
      }
      if (b.decision === "approve") {
        if (f.terms === "net30" && !(set.credit_limit_cents || f.credit_limit_cents)) throw bad("creditLimitCents", "Set a credit limit to approve net 30.");
        set.status = "active";
      } else if (b.decision === "decline" || b.decision === "pause") {
        if (note.length < 5) throw bad("note", "Say why. The fleet manager sees this.");
        set.status = b.decision === "decline" ? "declined" : "paused";
      } else if (b.decision === "reactivate") set.status = "active";
      else if (b.decision !== "update") throw bad("decision", "Choose approve, decline, pause, reactivate, or update.");
      if (note) set.decision_note = note;
      set.decided_at = now();
      const keys = Object.keys(set);
      await db.run(`UPDATE fleets SET ${keys.map((k, i) => `${k} = $${i + 1}`).join(", ")}, updated_at = $${keys.length + 1} WHERE id = $${keys.length + 2}`, [...keys.map((k) => set[k]), now(), f.id]);
      if (["approve", "decline", "pause", "reactivate"].includes(b.decision)) {
        const m = { approve: ["Your business account is approved", f.terms === "net30" ? `You can book fleet visits on net 30 invoices, up to ${fmtMoney(set.credit_limit_cents || f.credit_limit_cents)} open at a time.` : "You can book fleet visits now."],
          decline: ["About your business account", `We can't open net 30 billing right now. ${note} You can switch to card on file in the app.`],
          pause: ["Your business account is paused", note], reactivate: ["Your business account is active again", "You can book fleet visits again."] }[b.decision];
        await tell(f.owner_id, { category: "booking", title: m[0], body: m[1], data: { route: "/fleet" } });
      }
      log(`[fleet] ${b.decision} ${f.id} by ${staff.id}`);
      return (await api.staffList()).find((x) => x.id === f.id);
    },
    async staffInvoices(status) {
      const where = status === "open" ? `i.status = 'open'` : status === "pastdue" ? `i.status = 'open' AND i.due_at < ${Number(now())}` : status === "paid" ? `i.status = 'paid'` : "1 = 1";
      const rows = await db.all(`SELECT i.*, f.name AS fleet_name, f.terms FROM fleet_invoices i JOIN fleets f ON f.id = i.fleet_id WHERE ${where} ORDER BY i.issued_at DESC LIMIT 300`);
      return rows.map((i) => ({ ...invoiceOut(i), fleet: i.fleet_name, terms: i.terms }));
    },
    async staffMarkPaid(staff, id, b) {
      const note = text(b.note, 200);
      if (note.length < 3) throw bad("note", "Say how it was paid (check number, ACH reference).");
      const r = await db.run(`UPDATE fleet_invoices SET status = 'paid', paid_at = $1, paid_note = $2 WHERE id = $3 AND status = 'open'`, [now(), `${note} (recorded by staff)`, String(id)]);
      if (!r.changes) throw new HttpError(404, "not_found", "No open invoice with that ID.");
      return (await api.staffInvoices("all")).find((x) => x.id === String(id));
    },
    async staffRuns() {
      const rows = await db.all(`SELECT * FROM fleet_runs ORDER BY CASE WHEN status IN ('completed','cancelled') THEN 1 ELSE 0 END, window_start DESC LIMIT 200`);
      return Promise.all(rows.map((r) => runOut(r, { staff: true })));
    },
    async staffRun(id) {
      const r = await runRow(id);
      if (!r) throw new HttpError(404, "not_found", "No fleet visit with that ID.");
      return runOut(r, { staff: true });
    },
  };

  function checkVehicle(b) {
    const unit = text(b.unit, 30);
    if (!unit) throw bad("unit", "Add a unit number, like Unit 104.");
    const year = Number(b.year);
    if (!Number.isInteger(year) || year < 1950 || year > new Date(now()).getUTCFullYear() + 1) throw bad("year", "Enter the model year, like 2021.");
    const make = text(b.make, 40);
    if (!make) throw bad("make", "Add the make, like Ford.");
    const model = text(b.model, 60);
    if (!model) throw bad("model", "Add the model, like Transit 250.");
    if (!FLEET_CLASSES.includes(b.vehicleClass)) throw bad("vehicleClass", "Choose van/pickup, box truck, tractor, or trailer.");
    const plate = text(b.plate, 12).toUpperCase() || null;
    const vin = text(b.vin, 17).toUpperCase() || null;
    if (vin && !/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) throw bad("vin", "A VIN is 17 letters and numbers (no I, O, or Q).");
    let mileage = b.mileage == null || b.mileage === "" ? null : Number(String(b.mileage).replace(/[,\s]/g, ""));
    if (mileage != null && (!Number.isInteger(mileage) || mileage < 0 || mileage > 3_000_000)) throw bad("mileage", "Enter the mileage as a whole number.");
    return { unit, year, make, model, vehicleClass: b.vehicleClass, plate, vin, mileage };
  }

  async function checkRunPicks(f, b) {
    const vids = Array.isArray(b.vehicleIds) ? [...new Set(b.vehicleIds.map(String))] : [];
    if (!vids.length) throw bad("vehicleIds", "Pick at least one vehicle.");
    if (vids.length > MAX_VEHICLES_PER_RUN) throw bad("vehicleIds", `Pick up to ${MAX_VEHICLES_PER_RUN} vehicles per visit.`);
    const vehicles = [];
    for (const id of vids) {
      const v = await db.get(`SELECT * FROM fleet_vehicles WHERE id = $1 AND fleet_id = $2 AND archived_at IS NULL`, [id, f.id]);
      if (!v) throw bad("vehicleIds", "One of those vehicles isn't on your account.");
      vehicles.push(v);
    }
    const sids = Array.isArray(b.serviceIds) ? [...new Set(b.serviceIds.map(String))] : [];
    if (!sids.length) throw bad("serviceIds", "Pick at least one service.");
    for (const id of sids) if (!serviceById(id)) throw bad("serviceIds", "One of those services isn't offered.");
    return { vehicles, serviceIds: sids };
  }

  function estimateFor(vehicles, serviceIds, s, laborRate) {
    const out = vehicles.map((v) => {
      const { lines, skipped } = priceVehicle(v, serviceIds, s, laborRate);
      return { vehicleId: v.id, unit: v.unit, classLabel: CLASS_LABEL[v.vehicle_class], lines, skipped, subtotalCents: sum(lines) };
    });
    const services = out.reduce((a, v) => a + v.subtotalCents, 0);
    const trip = out.some((v) => v.lines.length) ? cents(s.fleetTrip) : 0;
    return { vehicles: out, tripFeeCents: trip, totalCents: services + trip, laborRate };
  }

  return api;
}
