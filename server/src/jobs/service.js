// The job record and its 11 steps (prototypes/job-flow.html), with the rules in docs/RULES.md.
// Money is recorded here in cents; payments/service.js moves it (cards, deposits, holds, charges, partner ledger).
// Photos come with step 10, dispatch offers and distance matching with step 7.
import { HttpError } from "../lib/http.js";
import { newId } from "../auth/tokens.js";
import { serviceById } from "../catalog/services.js";
import { priceLine, customerTotal, partnerPay, glassQuote, PricingError } from "../pricing/engine.js";
import { vehicleOut, placeArea } from "../profiles/routes.js";
import { milesBetween, driveMinutes, addressLine, maskContacts } from "../maps/geo.js";
import { ratingSummary } from "../care/summary.js";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const MAX_SERVICES = 15;
const MAX_OPEN_JOBS = 5;
const SCHEDULED_WINDOW_HOURS = 2;
const EARLIEST_BOOKING_HOURS = 2;
const LATEST_BOOKING_DAYS = 30;
const START_TRIP_EARLY_HOURS = 3;
const NO_SHOW_WAIT_MIN = 15;
const PARTNER_LATE_MIN = 30;
const LATE_PARTNER_CREDIT_CENTS = 1000; // RULES.md: partner hasn't left 30 min before the window → reschedule free with a $10 credit.
const FREE_RESCHEDULES = 2;
const WARRANTY_OFFER_HOURS = 24; // A warranty return goes to the original partner first, for up to 24 hours.
const RATE_DAYS = 14;
const TIP_HOURS = 24;
export const WARRANTY_ISSUES = { same_problem: "Same problem is back", new_noise: "New noise or leak since the repair", warning_light: "Warning light came on", loose_missing: "Something was left loose or missing" };
const fmtMoney = (c) => `$${(c / 100).toFixed(2).replace(/\.00$/, "")}`;
const fmtWhen = (ms) => new Date(ms).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });

export const STATUSES = ["requested", "awaiting_approval", "confirmed", "en_route", "arrived", "in_progress", "completed", "cancelled", "expired"];
export const INSPECTION_ITEMS = ["brakes", "tires", "fluids", "battery", "wipers", "lights", "belts_hoses", "filters"];
const INSPECTION_LABELS = { brakes: "Brakes", tires: "Tires", fluids: "Fluids", battery: "Battery", wipers: "Wipers", lights: "Lights", belts_hoses: "Belts & hoses", filters: "Filters" };
const ADDRESS_VISIBLE = new Set(["en_route", "arrived", "in_progress"]);
const OPEN = ["requested", "awaiting_approval", "confirmed", "en_route", "arrived", "in_progress"];

const bad = (field, msg) => new HttpError(422, "invalid_input", "Some fields need fixing.", { fields: { [field]: msg } });
const conflict = (msg) => new HttpError(409, "wrong_step", msg);
const notFound = () => new HttpError(404, "not_found", "That job isn't on your account. Pull to refresh and try again.");
const J = (s, fallback = null) => (s ? JSON.parse(s) : fallback);
const shortName = (u) => (u ? `${u.first_name} ${u.last_name ? u.last_name[0] + "." : ""}`.trim() : null);

function parseTime(v, field) {
  const ms = typeof v === "number" ? v : typeof v === "string" ? Date.parse(v) : NaN;
  if (!Number.isFinite(ms)) throw bad(field, "Pick a date and time.");
  return ms;
}

export function createJobs({ db, settings, geocode = null, payments = null, onboarding = null, photos = null, notify = null, requirePhotos = false, now = () => Date.now(), log = () => {} }) {
  // Notifications go into the inbox inside the same transaction; delivery (push, text, email) happens after it's saved.
  const tell = (q, uid, m) => (notify ? notify.send(q, uid, m) : null);
  const jobRoute = (id) => ({ route: "/job", params: { id } });
  const svcNames = (job) => J(job.quote, { lines: [] }).lines.map((l) => l.name).concat((J(job.quote, {}).pending || []).map((l) => l.name)).join(", ");
  const firstName = async (q, id) => ((await q.get(`SELECT first_name FROM users WHERE id = $1`, [id])) || {}).first_name || "Your partner";
  const zeroPay = (s) => ({ laborCents: 0, feePct: s.fee, feeCents: 0, visitFeeCents: 0, topUpCents: 0, earningsCents: 0, partsReimbursedCents: 0, platformCents: 0 });
  // Card charges talk to Stripe, so they run after the job change is saved, never inside a transaction.
  // A payment problem never undoes a job change; it shows on the job as a payment status instead.
  async function money(id, hook) {
    if (!payments) return;
    const job = await db.get(`SELECT * FROM jobs WHERE id = $1`, [id]);
    try { await hook(job); } catch (e) { log(`[payments] ${e.message} (job ${id})`); }
  }

  // Event IDs sort in the order events happened, even within the same millisecond.
  let seq = 0;
  const eventId = () => `${String(now()).padStart(15, "0")}-${String(seq++ % 1e6).padStart(6, "0")}-${newId().slice(0, 8)}`;
  const event = (t, jobId, actorId, kind, data) =>
    t.run(`INSERT INTO job_events (id, job_id, actor_id, kind, data, created_at) VALUES ($1, $2, $3, $4, $5, $6)`, [eventId(), jobId, actorId || null, kind, data ? JSON.stringify(data) : null, now()]);

  const settingsFor = async (version) => (await settings.version(version)).settings;
  const getJob = (t, id) => t.get(`SELECT * FROM jobs WHERE id = $1`, [String(id)]);

  async function update(t, job, fields) {
    const cols = Object.keys(fields);
    await t.run(`UPDATE jobs SET ${cols.map((k, i) => `${k} = $${i + 1}`).join(", ")}, updated_at = $${cols.length + 1} WHERE id = $${cols.length + 2}`, [...cols.map((k) => fields[k]), now(), job.id]);
    return { ...job, ...fields };
  }

  // Customer fee if they cancel right now (RULES.md, Cancellations).
  function customerCancelFee(job, s) {
    if (job.status === "en_route" || job.status === "arrived") return { cents: Math.round(s.enroute * 100), reason: "Your partner is already on the way." };
    if (job.status === "confirmed" && job.window_start - now() <= s.cancelH * HOUR) return { cents: Math.round(s.late * 100), reason: `It's less than ${s.cancelH} hours before your visit.` };
    return { cents: 0, reason: null };
  }
  const partnerShare = (feeCents, s) => Math.round(feeCents * (1 - s.fee / 100));

  // Partner hasn't started the trip 30 minutes before the window: the customer can switch or reschedule free.
  const partnerLate = (job) => job.status === "confirmed" && !job.trip_started_at && now() >= job.window_start - PARTNER_LATE_MIN * MIN;

  async function releaseToRequested(t, job, { exclude, kind, actorId, data }) {
    const excluded = J(job.excluded_partners, []);
    if (exclude && !excluded.includes(exclude)) excluded.push(exclude);
    const s = await settingsFor(job.settings_version);
    const expires = job.kind === "scheduled" ? job.window_start : Math.max(job.request_expires_at, now() + (job.kind === "roadside" ? s.roadside : s.window) * HOUR);
    const next = await update(t, job, {
      status: "requested", partner_id: null, accepted_at: null, confirmed_at: null, approval_deadline: null, dispatch_phase: "board",
      excluded_partners: JSON.stringify(excluded), priority: 1, request_expires_at: expires,
    });
    await event(t, job.id, actorId, kind, data);
    return next;
  }

  // ---------- Dispatch (RULES.md, Dispatch) ----------
  // Partners who could take this job: approved, offer every service on it, and the job is inside their circle
  // (or inside the wider 35-mile search once it widens). Sorted closest first.
  async function candidates(t, job, s) {
    const rows = await t.all(
      `SELECT u.id, a.lat, a.lng, a.radius_miles FROM users u JOIN partner_profiles p ON p.user_id = u.id
       LEFT JOIN partner_service_areas a ON a.user_id = u.id WHERE p.status = 'active'`,
    );
    if (!rows.length) return [];
    const need = J(job.service_ids, []);
    const offered = new Map();
    for (const r of await t.all(`SELECT user_id, service_id FROM partner_services`)) {
      if (!offered.has(r.user_id)) offered.set(r.user_id, new Set());
      offered.get(r.user_id).add(r.service_id);
    }
    const excluded = new Set(J(job.excluded_partners, []));
    const out = [];
    for (const r of rows) {
      if (excluded.has(r.id) || r.id === job.customer_id) continue;
      const has = offered.get(r.id);
      if (!has || !need.every((x) => has.has(x))) continue;
      const d = reach(job, r, s);
      if (d === false) continue;
      if (onboarding && (await onboarding.coverageProblem(r.id))) continue; // Insurance lapsed: no offers until renewed.
      out.push({ partnerId: r.id, distance: d });
    }
    // Partners the customer marked as a favorite get the first offers.
    const favs = new Set((await t.all(`SELECT partner_id FROM favorite_partners WHERE customer_id = $1`, [job.customer_id])).map((r) => r.partner_id));
    return out.sort((a, b) => (favs.has(b.partnerId) - favs.has(a.partnerId)) || ((a.distance ?? 1e9) - (b.distance ?? 1e9)));
  }

  // Distance in miles if the partner can reach the job, null if distance isn't known, false if out of range.
  function reach(job, area, s) {
    if (job.lat == null) return null; // No map location (no Google key or address not found yet): don't filter by distance.
    if (!area || area.lat == null) return false;
    const d = milesBetween({ lat: job.lat, lng: job.lng }, area);
    const limit = job.widened_at ? Math.max(area.radius_miles, s.widenMi) : area.radius_miles;
    return d <= limit ? Math.round(d * 10) / 10 : false;
  }

  // Instant jobs: send the next offer, or open the job to everyone in range once 5 partners have had a turn.
  async function dispatchNext(t, job) {
    if (job.status !== "requested" || job.dispatch_phase !== "offers") return;
    const pending = await t.get(`SELECT id FROM job_offers WHERE job_id = $1 AND status = 'pending'`, [job.id]);
    if (pending) return;
    const s = await settingsFor(job.settings_version);
    const tried = new Set((await t.all(`SELECT partner_id FROM job_offers WHERE job_id = $1`, [job.id])).map((r) => r.partner_id));
    const next = job.offers_sent < s.offerMax && job.lat != null ? (await candidates(t, job, s)).find((c) => !tried.has(c.partnerId) && c.distance != null) : null;
    if (!next) {
      await update(t, job, { dispatch_phase: "board" });
      await event(t, job.id, null, "sent_to_all", { note: job.offers_sent ? `${job.offers_sent} partners had a turn; now everyone in range can take it.` : "Everyone in range can take it." });
      return;
    }
    const at = now();
    await t.run(`INSERT INTO job_offers (id, job_id, partner_id, distance_miles, status, sent_at, expires_at) VALUES ($1, $2, $3, $4, 'pending', $5, $6)`,
      [newId(), job.id, next.partnerId, next.distance, at, at + s.offerSecs * 1000]);
    await update(t, job, { offers_sent: job.offers_sent + 1 });
    await event(t, job.id, null, "offer_sent", { partnerId: next.partnerId, distanceMiles: next.distance });
    const pay = partnerPay(J(job.quote).lines, s, { mobile: true });
    await tell(t, next.partnerId, {
      category: "offers", title: `${job.kind === "roadside" ? "Roadside request" : "New job offer"} · ${s.offerSecs} seconds to answer`,
      body: `${svcNames(job)} · ${next.distance} mi away · You earn ${fmtMoney(pay.earningsCents)}. Open the app to accept.`, data: { route: "/home" },
    });
  }

  // Looks up the job's address on the map if the place doesn't have a location yet.
  async function locateJob(place) {
    if (place.lat != null || !geocode || place.geo_status === "not_found") return { lat: place.lat, lng: place.lng };
    const g = await geocode(addressLine(place));
    if (g.status === "ok") {
      await db.run(`UPDATE places SET lat = $1, lng = $2, geo_status = 'ok' WHERE id = $3`, [g.lat, g.lng, place.id]);
      return { lat: g.lat, lng: g.lng };
    }
    if (g.status === "not_found") await db.run(`UPDATE places SET geo_status = 'not_found' WHERE id = $1`, [place.id]);
    return { lat: null, lng: null };
  }

  // A warranty return goes out to every partner in range (the original partner can't or didn't take it).
  async function warrantyToBoard(t, job, { kind, note, actorId = null }) {
    const excluded = J(job.excluded_partners, []);
    if (job.comeback_partner_id && !excluded.includes(job.comeback_partner_id)) excluded.push(job.comeback_partner_id);
    await update(t, job, { dispatch_phase: "board", excluded_partners: JSON.stringify(excluded), priority: 1, offer_until: null });
    await event(t, job.id, actorId, kind, { note });
    await tell(t, job.customer_id, { category: "claims", title: "Another partner will handle your warranty return", body: "Your original partner can't make it, so we're offering it to other partners nearby. It's still free.", data: jobRoute(job.id) });
  }

  // ---------- Time-based changes. Runs before every jobs request and every few seconds in the server. ----------
  async function sweep() {
    const at = now();
    // Offers that ran out, then the next offer for each instant job that's waiting on one.
    const lapsed = await db.all(`SELECT * FROM job_offers WHERE status = 'pending' AND expires_at <= $1`, [at]);
    for (const o of lapsed) {
      await db.tx(async (t) => {
        const r = await t.run(`UPDATE job_offers SET status = 'expired', decided_at = $1 WHERE id = $2 AND status = 'pending'`, [at, o.id]);
        if (r.changes) await event(t, o.job_id, null, "offer_expired", { partnerId: o.partner_id });
      });
    }
    const waiting = await db.all(`SELECT * FROM jobs WHERE status = 'requested' AND dispatch_phase = 'offers' AND request_expires_at > $1`, [at]);
    for (const j of waiting) await db.tx(async (t) => dispatchNext(t, await getJob(t, j.id)));
    // Halfway through the request window the search widens (RULES.md: to 35 miles).
    const toWiden = await db.all(`SELECT * FROM jobs WHERE status = 'requested' AND widened_at IS NULL AND created_at + (request_expires_at - created_at) / 2 <= $1 AND request_expires_at > $1`, [at]);
    for (const j of toWiden) {
      await db.tx(async (t) => {
        const s = await settingsFor(j.settings_version);
        const r = await t.run(`UPDATE jobs SET widened_at = $1, updated_at = $1 WHERE id = $2 AND widened_at IS NULL`, [at, j.id]);
        if (r.changes) await event(t, j.id, null, "search_widened", { miles: s.widenMi });
      });
    }
    // Warranty returns the original partner didn't take in time go to everyone in range.
    const warrantyLate = await db.all(`SELECT * FROM jobs WHERE status = 'requested' AND dispatch_phase = 'warranty' AND offer_until <= $1 AND request_expires_at > $1`, [at]);
    for (const j of warrantyLate) {
      await db.tx(async (t) => {
        const cur = await getJob(t, j.id);
        if (cur.status !== "requested" || cur.dispatch_phase !== "warranty") return;
        await warrantyToBoard(t, cur, { kind: "warranty_to_board", note: "The original partner didn't answer in time." });
      });
    }
    const expired = await db.all(`SELECT * FROM jobs WHERE status = 'requested' AND request_expires_at <= $1`, [at]);
    for (const j of expired) {
      await db.tx(async (t) => {
        const r = await t.run(`UPDATE jobs SET status = 'expired', updated_at = $1 WHERE id = $2 AND status = 'requested'`, [at, j.id]);
        if (r.changes) {
          await event(t, j.id, null, "expired", { note: "No partner accepted in time. Any deposit is refunded." });
          await tell(t, j.customer_id, { category: "booking", title: "No partner could take your visit", body: `Nobody was free for your ${svcNames(j)} in time. You weren't charged. Pick another time in the app.`, data: jobRoute(j.id) });
        }
      });
      await money(j.id, (job) => job.status === "expired" && payments.afterCancel(job));
    }
    const late = await db.all(`SELECT * FROM jobs WHERE status = 'awaiting_approval' AND approval_deadline <= $1`, [at]);
    for (const j of late) {
      await db.tx(async (t) => {
        const cur = await getJob(t, j.id);
        if (cur.status !== "awaiting_approval") return;
        await releaseToRequested(t, cur, { exclude: cur.partner_id, kind: "approval_timed_out", data: { partnerId: cur.partner_id, note: "Customer didn't answer in time. The job goes to the next partner." } });
        await tell(t, cur.partner_id, { category: "jobs", title: "The customer didn't answer in time", body: `The ${svcNames(cur)} job went to another partner. Nothing counts against you.`, data: { route: "/home" } });
        await tell(t, cur.customer_id, { category: "booking", title: "Finding you another partner", body: "Time ran out to approve your partner, so we're offering your visit to the next one.", data: jobRoute(cur.id) });
      });
    }
    // Card holds for visits coming up soon, and scheduled partner payouts.
    if (payments && payments.enabled) {
      try {
        await payments.holdsDue((await settings.current()).settings);
        await payments.runScheduled();
      } catch (e) { log(`[payments] ${e.message}`); }
    }
    return { expired: expired.length, approvalTimeouts: late.length };
  }

  // ---------- Views ----------
  async function addonsOf(t, jobId) {
    return (await t.all(`SELECT * FROM job_addons WHERE job_id = $1 ORDER BY created_at`, [jobId])).map((a) => ({
      id: a.id, kind: a.kind, serviceId: a.service_id, reason: a.reason, line: J(a.line), status: a.status, createdAt: a.created_at, decidedAt: a.decided_at,
    }));
  }

  async function timeline(t, jobId) {
    return (await t.all(`SELECT kind, data, created_at FROM job_events WHERE job_id = $1 ORDER BY id`, [jobId])).map((e) => ({ kind: e.kind, at: e.created_at, ...(J(e.data) || {}) }));
  }

  async function jobsDone(t, partnerId) {
    return Number((await t.get(`SELECT COUNT(*) AS n FROM jobs WHERE partner_id = $1 AND status = 'completed'`, [partnerId])).n);
  }

  async function customerPhotos(t, job) {
    const p = await photos.forJob(t, job.id);
    return { checkin: p.checkin, after: job.status === "completed" ? p.after : [], damage: p.damage };
  }

  async function customerView(t, job) {
    const s = await settingsFor(job.settings_version);
    const [vehicle, place, partner, addons, events] = await Promise.all([
      t.get(`SELECT * FROM vehicles WHERE id = $1`, [job.vehicle_id]),
      t.get(`SELECT * FROM places WHERE id = $1`, [job.place_id]),
      job.partner_id ? t.get(`SELECT id, first_name, last_name FROM users WHERE id = $1`, [job.partner_id]) : null,
      addonsOf(t, job.id),
      timeline(t, job.id),
    ]);
    const quote = J(job.quote);
    const strip = (l) => { const { partsCostCents, glassCostCents, ...rest } = l; return rest; };
    const fee = OPEN.includes(job.status) && job.status !== "in_progress" ? customerCancelFee(job, s) : null;
    return {
      id: job.id, status: job.status, kind: job.kind, settingsVersion: job.settings_version,
      vehicle: vehicleOut(vehicle), place: { id: place.id, label: place.label, street: place.street, unit: place.unit, city: place.city, state: place.state, zip: place.zip },
      windowStart: job.window_start, windowEnd: job.window_end, requestExpiresAt: job.request_expires_at, notes: job.notes,
      approvePartner: !!job.approve_partner, approvalDeadline: job.approval_deadline,
      partner: partner ? { id: partner.id, name: shortName(partner), jobsDone: await jobsDone(t, partner.id), rating: await ratingSummary(t, partner.id) } : null,
      quote: { ...(({ payLines: _pl, ...q }) => q)(quote), lines: quote.lines.map(strip) },
      addons: addons.map((a) => ({ ...a, line: a.line && strip(a.line) })),
      odometerIn: job.odometer_in, inspection: J(job.inspection), workNotes: job.work_notes,
      final: job.final ? (({ partnerPay: _p, ...rest }) => rest)(J(job.final)) : null,
      warrantyUntil: job.warranty_until, warrantyMilesUntil: job.warranty_miles_until,
      cancelledAt: job.cancelled_at, cancelledBy: job.cancelled_by, cancelReason: job.cancel_reason, cancelFeeCents: job.cancel_fee_cents,
      cancelPreview: fee ? { feeCents: fee.cents, reason: fee.reason } : null,
      rescheduleCount: job.reschedule_count, freeReschedulesLeft: Math.max(0, FREE_RESCHEDULES - job.reschedule_count),
      partnerLate: partnerLate(job),
      payment: payments ? await payments.summary(job, t) : null,
      // Check-in photos show once work starts; after photos once the job is done.
      photos: photos && ["in_progress", "completed", "cancelled"].includes(job.status) ? await customerPhotos(t, job) : null,
      timeline: events,
      ...(await afterCare(t, job)),
      createdAt: job.created_at, updatedAt: job.updated_at,
    };
  }

  // Rating, tip, claims, and warranty returns for a customer's job.
  async function afterCare(t, job) {
    const out = { warrantyReturn: null, care: null };
    if (job.comeback_of) {
      const w = await t.get(`SELECT * FROM warranty_returns WHERE return_job_id = $1`, [job.id]);
      out.warrantyReturn = { originalJobId: job.comeback_of, issue: w && w.issue, issueLabel: w && WARRANTY_ISSUES[w.issue], details: w && w.details, withOriginalPartner: job.dispatch_phase === "warranty" || (job.partner_id && job.partner_id === job.comeback_partner_id), photos: w && photos ? await photos.attached(t, "warranty", w.id) : [] };
    }
    if (job.status !== "completed") return out;
    const r = await t.get(`SELECT stars, tags, review, created_at FROM ratings WHERE job_id = $1`, [job.id]);
    const tip = await t.get(`SELECT amount_cents, status FROM tips WHERE job_id = $1 AND status <> 'failed' ORDER BY created_at DESC LIMIT 1`, [job.id]);
    const claims = await t.all(`SELECT id, number, status FROM claims WHERE job_id = $1 ORDER BY created_at DESC`, [job.id]);
    const returns = await t.all(`SELECT id, status, window_start FROM jobs WHERE comeback_of = $1 ORDER BY created_at DESC`, [job.comeback_of || job.id]);
    const origin = job.comeback_of ? await t.get(`SELECT warranty_until, warranty_miles_until FROM jobs WHERE id = $1`, [job.comeback_of]) : job;
    out.care = {
      rating: r ? { stars: r.stars, tags: J(r.tags, []), review: r.review, at: r.created_at } : null,
      canRate: !r && !!job.partner_id && now() - job.completed_at <= RATE_DAYS * DAY, rateOpenUntil: job.completed_at + RATE_DAYS * DAY,
      tip: tip ? { amountCents: tip.amount_cents, status: tip.status } : null, tipOpenUntil: job.completed_at + TIP_HOURS * HOUR,
      claims: claims.map((c) => ({ id: c.id, number: `CLM-${c.number}`, status: c.status })),
      warrantyActive: !!(origin && origin.warranty_until && origin.warranty_until > now()),
      warrantyUntil: origin ? origin.warranty_until : null,
      openWarrantyReturn: (returns.find((x) => OPEN.includes(x.status)) || {}).id || null,
      warrantyReturns: returns.map((x) => ({ id: x.id, status: x.status, windowStart: x.window_start })),
    };
    return out;
  }

  // What a partner sees. The street address, unit, and notes only show while they're driving to or working on the job.
  async function partnerView(t, job, partnerId) {
    const s = await settingsFor(job.settings_version);
    const [vehicle, place, cust, addons] = await Promise.all([
      t.get(`SELECT * FROM vehicles WHERE id = $1`, [job.vehicle_id]),
      t.get(`SELECT * FROM places WHERE id = $1`, [job.place_id]),
      t.get(`SELECT first_name, last_name FROM users WHERE id = $1`, [job.customer_id]),
      job.partner_id === partnerId ? addonsOf(t, job.id) : [],
    ]);
    const mine = job.partner_id === partnerId;
    const quote = J(job.quote);
    const approvedExtra = addons.filter((a) => a.status === "approved").map((a) => a.line);
    // Warranty returns: free for the customer. The original partner redoes the work for no pay; another partner is paid
    // the usual amount, charged back to the original partner.
    const originalRedo = job.comeback_of && (job.partner_id ? job.partner_id === job.comeback_partner_id : partnerId === job.comeback_partner_id);
    const pay = job.comeback_of ? (originalRedo ? zeroPay(s) : partnerPay(quote.payLines || [], s, { mobile: true })) : partnerPay([...quote.lines, ...approvedExtra], s, { mobile: true });
    const showAddress = mine && ADDRESS_VISIBLE.has(job.status);
    const v = vehicleOut(vehicle);
    const area = await t.get(`SELECT lat, lng FROM partner_service_areas WHERE user_id = $1`, [partnerId]);
    const dist = job.lat != null && area && area.lat != null ? Math.round(milesBetween({ lat: job.lat, lng: job.lng }, area) * 10) / 10 : null;
    const out = {
      id: job.id, status: job.status, kind: job.kind, mine,
      customer: { name: shortName(cust) },
      vehicle: { year: v.year, make: v.make, model: v.model, trim: v.trim, color: v.color, fuel: v.fuel, mileage: v.mileage, oilPreference: v.oilPreference, ...(mine ? { vin: v.vin, plate: v.plate, plateState: v.plateState } : {}) },
      area: placeArea(place), parking: place.parking,
      place: showAddress ? { street: place.street, unit: place.unit, city: place.city, state: place.state, zip: place.zip, notes: place.notes } : null,
      addressHiddenUntil: showAddress ? null : "start_trip",
      windowStart: job.window_start, windowEnd: job.window_end, requestExpiresAt: job.request_expires_at, notes: job.notes,
      services: quote.lines.map((l) => ({ serviceId: l.serviceId, name: l.name, hours: l.hours, priceCents: l.priceCents, partsCostCents: l.partsCostCents })),
      pendingQuotes: quote.pending,
      pay: { ...(({ platformCents, ...rest }) => rest)(pay) },
      approvalDeadline: job.approval_deadline,
      distanceMiles: dist, driveMinutes: driveMinutes(dist),
      warranty: job.comeback_of ? await (async () => {
        const w = await t.get(`SELECT * FROM warranty_returns WHERE return_job_id = $1`, [job.id]);
        return { originalJobId: job.comeback_of, original: partnerId === job.comeback_partner_id, offerUntil: job.dispatch_phase === "warranty" ? job.offer_until : null,
          issue: w && w.issue, issueLabel: w && WARRANTY_ISSUES[w.issue], details: w && w.details, photos: w && photos ? await photos.attached(t, "warranty", w.id) : [] };
      })() : null,
    };
    if (mine) {
      Object.assign(out, {
        addons, odometerIn: job.odometer_in, inspection: J(job.inspection), workNotes: job.work_notes,
        arrivedAt: job.arrived_at, noShowAllowedAt: job.arrived_at ? job.arrived_at + NO_SHOW_WAIT_MIN * MIN : null,
        canStartTripAt: job.window_start - START_TRIP_EARLY_HOURS * HOUR,
        final: job.final ? { partnerPay: J(job.final).partnerPay } : null,
        cancelledAt: job.cancelled_at, cancelledBy: job.cancelled_by, cancelReason: job.cancel_reason, partnerCompCents: job.partner_comp_cents,
        freeCancelUntil: job.window_start - s.pcxFreeHrs * HOUR,
        inspectionItems: INSPECTION_ITEMS.map((k) => ({ key: k, label: INSPECTION_LABELS[k] })),
        photos: photos ? await photos.forJob(t, job.id) : null, photosRequired: !!(photos && requirePhotos),
        tipCents: Number((await t.get(`SELECT COALESCE(SUM(amount_cents), 0) AS c FROM tips WHERE job_id = $1 AND status <> 'failed'`, [job.id])).c),
        rating: job.status === "completed" ? await (async () => { const r = await t.get(`SELECT stars, review, hidden_at FROM ratings WHERE job_id = $1`, [job.id]); return r ? { stars: r.stars, review: r.hidden_at ? null : r.review } : null; })() : null,
        customerRated: !!(await t.get(`SELECT job_id FROM customer_ratings WHERE job_id = $1`, [job.id])),
        claims: (await t.all(`SELECT id, number, status FROM claims WHERE job_id = $1`, [job.id])).map((c) => ({ id: c.id, number: `CLM-${c.number}`, status: c.status })),
      });
    }
    return out;
  }

  // ---------- Loading for a user ----------
  async function forCustomer(t, user, id) {
    const job = await getJob(t, id);
    if (!job || job.customer_id !== user.id) throw notFound();
    return job;
  }
  async function forPartner(t, user, id, { mine = true } = {}) {
    const job = await getJob(t, id);
    if (!job || (mine && job.partner_id !== user.id)) throw notFound();
    return job;
  }
  const need = (job, statuses, msg) => { if (!statuses.includes(job.status)) throw conflict(msg); };

  async function partnerStatus(t, userId) {
    const p = await t.get(`SELECT status FROM partner_profiles WHERE user_id = $1`, [userId]);
    return p ? p.status : "applicant";
  }

  // Chat is open from when a partner is confirmed until 24 hours after the job ends.
  const CHAT = ["confirmed", "en_route", "arrived", "in_progress", "completed", "cancelled"];
  function chatOpen(job) {
    if (["confirmed", "en_route", "arrived", "in_progress"].includes(job.status)) return true;
    const end = job.completed_at || job.cancelled_at;
    return !!(end && now() - end < DAY && job.partner_id);
  }
  async function chatJob(t, user, id) {
    const job = await getJob(t, id);
    if (!job || (job.customer_id !== user.id && job.partner_id !== user.id) || !CHAT.includes(job.status) || !job.partner_id) throw notFound();
    return job;
  }

  function priceAll(serviceIds, vehicle, s) {
    try { return serviceIds.map((id) => priceLine(id, vehicle, s)); } catch (e) {
      if (e instanceof PricingError) throw bad("serviceIds", e.message);
      throw e;
    }
  }

  function checkServiceIds(ids, field = "serviceIds", max = MAX_SERVICES) {
    if (!Array.isArray(ids) || !ids.length || ids.some((x) => typeof x !== "string")) throw bad(field, "Pick at least one service.");
    if (ids.length > max) throw bad(field, `Pick up to ${max} services.`);
    if (new Set(ids).size !== ids.length) throw bad(field, "Each service can only be added once.");
    for (const id of ids) {
      const svc = serviceById(id);
      if (!svc) throw bad(field, "One of those services isn't offered. Update the app and try again.");
      if (svc.category === "fleet") throw bad(field, "Fleet services are booked through a fleet account.");
    }
    return ids;
  }

  return {
    sweep,
    customerView,
    partnerView,
    INSPECTION_ITEMS,

    // ---------- Step 1: Booked ----------
    async book(user, b) {
      const ids = checkServiceIds(b.serviceIds);
      const kind = ["scheduled", "asap", "roadside"].includes(b.kind) ? b.kind : null;
      if (!kind) throw bad("kind", "Choose a scheduled visit, as soon as possible, or roadside help.");
      if (kind === "roadside" && ids.some((id) => serviceById(id).category !== "roadside")) throw bad("serviceIds", "Roadside requests can only include roadside services. Book the rest as a separate visit.");
      if (b.approvePartner != null && typeof b.approvePartner !== "boolean") throw bad("approvePartner", "Choose yes or no.");
      const notes = b.notes == null || b.notes === "" ? null : String(b.notes).trim().slice(0, 500) || null;
      const vehicle = await db.get(`SELECT * FROM vehicles WHERE id = $1 AND user_id = $2 AND archived_at IS NULL`, [String(b.vehicleId || ""), user.id]);
      if (!vehicle) throw bad("vehicleId", "Choose one of your vehicles.");
      const place = await db.get(`SELECT * FROM places WHERE id = $1 AND user_id = $2 AND archived_at IS NULL`, [String(b.placeId || ""), user.id]);
      if (!place) throw bad("placeId", "Choose where we should meet you.");

      const cur = await settings.current();
      const s = cur.settings;
      const at = now();
      let windowStart;
      let windowEnd;
      let expires;
      if (kind === "scheduled") {
        windowStart = parseTime(b.windowStart, "windowStart");
        if (windowStart < at + EARLIEST_BOOKING_HOURS * HOUR) throw bad("windowStart", `Pick a time at least ${EARLIEST_BOOKING_HOURS} hours from now, or choose As soon as possible.`);
        if (windowStart > at + LATEST_BOOKING_DAYS * DAY) throw bad("windowStart", `You can book up to ${LATEST_BOOKING_DAYS} days ahead.`);
        windowEnd = windowStart + SCHEDULED_WINDOW_HOURS * HOUR;
        expires = windowStart;
      } else {
        const hours = kind === "roadside" ? s.roadside : s.window;
        windowStart = at;
        windowEnd = at + hours * HOUR;
        expires = windowEnd;
      }

      const open = Number((await db.get(`SELECT COUNT(*) AS n FROM jobs WHERE customer_id = $1 AND status IN ('requested','awaiting_approval','confirmed','en_route','arrived','in_progress')`, [user.id])).n);
      if (open >= MAX_OPEN_JOBS) throw new HttpError(422, "too_many", `You have ${open} open bookings. Finish or cancel one before booking another.`);

      const lines = priceAll(ids, vehicleOut(vehicle), s);
      const total = customerTotal(lines, s, { mobile: true });
      if (payments) await payments.requireCard(user.id);
      const where = await locateJob(place);
      const id = newId();
      await db.tx(async (t) => {
        await t.run(
          `INSERT INTO jobs (id, customer_id, vehicle_id, place_id, kind, status, service_ids, settings_version, quote, notes, window_start, window_end, request_expires_at, approve_partner, lat, lng, dispatch_phase, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, 'requested', $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $17)`,
          [id, user.id, vehicle.id, place.id, kind, JSON.stringify(ids), cur.version, JSON.stringify(total), notes, windowStart, windowEnd, expires, b.approvePartner ? 1 : 0,
            where.lat, where.lng, kind === "scheduled" ? "board" : "offers", at],
        );
        await event(t, id, user.id, "booked", { totalCents: total.totalCents, depositCents: total.depositCents });
      });
      // Deposit (jobs over the threshold) is charged now; if it fails, the booking doesn't go through.
      if (payments) {
        const r = await payments.afterBooking(await db.get(`SELECT * FROM jobs WHERE id = $1`, [id]), s);
        if (!r.ok) {
          await db.tx(async (t) => {
            await update(t, { id }, { status: "cancelled", cancelled_at: now(), cancelled_by: "customer", cancel_reason: "deposit_failed", cancel_fee_cents: 0 });
            await event(t, id, null, "deposit_failed", { note: r.message });
          });
          throw new HttpError(402, "card_declined", r.message, { fields: { card: r.message } });
        }
      }
      // Instant jobs go to the closest qualified partner first.
      await db.tx(async (t) => dispatchNext(t, await getJob(t, id)));
      return db.tx(async (t) => customerView(t, await getJob(t, id)));
    },

    async listForCustomer(user) {
      const rows = await db.all(`SELECT * FROM jobs WHERE customer_id = $1 ORDER BY CASE WHEN status IN ('completed','cancelled','expired') THEN 1 ELSE 0 END, window_start DESC LIMIT 100`, [user.id]);
      return db.tx(async (t) => Promise.all(rows.map((j) => customerView(t, j))));
    },

    async getForCustomer(user, id) {
      return db.tx(async (t) => customerView(t, await forCustomer(t, user, id)));
    },

    // ---------- Step 2: Finding a partner (job board until dispatch arrives in step 7) ----------
    async board(user) {
      const status = await partnerStatus(db, user.id);
      if (status !== "active") {
        return { jobs: [], blocked: status === "paused" ? "Your account is paused, so you can't take new jobs. Contact partner support." : "You can see and take jobs once your application is approved." };
      }
      const lapsed = onboarding && (await onboarding.coverageProblem(user.id));
      if (lapsed) return { jobs: [], blocked: lapsed };
      const offered = new Set((await db.all(`SELECT service_id FROM partner_services WHERE user_id = $1`, [user.id])).map((r) => r.service_id));
      const area = await db.get(`SELECT * FROM partner_service_areas WHERE user_id = $1`, [user.id]);
      // Only jobs open to everyone in range (instant jobs reach the board after one-at-a-time offers).
      const rows = await db.all(`SELECT * FROM jobs WHERE status = 'requested' AND dispatch_phase = 'board' AND request_expires_at > $1 ORDER BY priority DESC, CASE kind WHEN 'roadside' THEN 0 WHEN 'asap' THEN 1 ELSE 2 END, window_start LIMIT 300`, [now()]);
      const fits = [];
      for (const j of rows) {
        if (J(j.excluded_partners, []).includes(user.id) || !J(j.service_ids, []).every((id) => offered.has(id))) continue;
        if (reach(j, area, await settingsFor(j.settings_version)) === false) continue;
        fits.push(j);
      }
      // Warranty returns waiting for this partner come first.
      const mineWarranty = await db.all(`SELECT * FROM jobs WHERE status = 'requested' AND dispatch_phase = 'warranty' AND comeback_partner_id = $1 AND request_expires_at > $2 ORDER BY window_start`, [user.id, now()]);
      return db.tx(async (t) => ({
        jobs: await Promise.all([...mineWarranty, ...fits.slice(0, 50)].map((j) => partnerView(t, j, user.id))), blocked: null, servicesOffered: offered.size,
        serviceAreaOnMap: !!(area && area.geo_status === "ok"), mapsOn: !!geocode,
      }));
    },

    async listForPartner(user) {
      const rows = await db.all(`SELECT * FROM jobs WHERE partner_id = $1 ORDER BY CASE WHEN status IN ('completed','cancelled','expired') THEN 1 ELSE 0 END, window_start LIMIT 100`, [user.id]);
      return db.tx(async (t) => Promise.all(rows.map((j) => partnerView(t, j, user.id))));
    },

    async getForPartner(user, id) {
      return db.tx(async (t) => {
        const job = await getJob(t, id);
        if (!job) throw notFound();
        // Partners can look at open jobs on the board, and at their own jobs.
        if (job.partner_id !== user.id && job.status !== "requested") throw notFound();
        if (job.status === "requested" && job.dispatch_phase === "warranty" && job.comeback_partner_id !== user.id) throw notFound();
        return partnerView(t, job, user.id);
      });
    },

    async accept(user, id) {
      return db.tx(async (t) => {
        if ((await partnerStatus(t, user.id)) !== "active") throw new HttpError(403, "not_active", "You can take jobs once your application is approved.");
        const lapsed = onboarding && (await onboarding.coverageProblem(user.id));
        if (lapsed) throw new HttpError(403, "coverage_lapsed", lapsed);
        const job = await forPartner(t, user, id, { mine: false });
        if (job.status !== "requested" || job.request_expires_at <= now()) throw conflict("Another partner already took this job, or it closed.");
        if (J(job.excluded_partners, []).includes(user.id)) throw conflict("This job went to another partner.");
        // A warranty return waiting for its original partner: only they can take it, wherever they are.
        const warrantyMine = job.dispatch_phase === "warranty";
        if (warrantyMine && job.comeback_partner_id !== user.id) throw conflict("This warranty return is waiting for the original partner.");
        const offered = new Set((await t.all(`SELECT service_id FROM partner_services WHERE user_id = $1`, [user.id])).map((r) => r.service_id));
        const missing = warrantyMine ? [] : J(job.service_ids, []).filter((x) => !offered.has(x));
        if (missing.length) throw conflict(`You don't offer ${missing.map((x) => serviceById(x).name).join(", ")}. Turn it on in Services first.`);
        const s = await settingsFor(job.settings_version);
        const at = now();
        const myOffer = await t.get(`SELECT * FROM job_offers WHERE job_id = $1 AND partner_id = $2 AND status = 'pending' AND expires_at > $3`, [job.id, user.id, at]);
        if (!myOffer && !warrantyMine) {
          if (job.dispatch_phase !== "board") throw conflict("This job is being offered to another partner right now.");
          const area = await t.get(`SELECT * FROM partner_service_areas WHERE user_id = $1`, [user.id]);
          if (reach(job, area, s) === false) throw conflict("This job is outside your service area.");
        }
        const sameDay = job.kind !== "scheduled" || job.window_start - at < DAY;
        const fields = job.approve_partner
          ? { status: "awaiting_approval", partner_id: user.id, accepted_at: at, approval_deadline: at + (sameDay ? s.approveNow : s.approveLater) * MIN }
          : { status: "confirmed", partner_id: user.id, accepted_at: at, confirmed_at: at };
        const r = await t.run(
          `UPDATE jobs SET status = $1, partner_id = $2, accepted_at = $3, approval_deadline = $4, confirmed_at = $5, updated_at = $3 WHERE id = $6 AND status = 'requested' AND partner_id IS NULL`,
          [fields.status, user.id, at, fields.approval_deadline || null, fields.confirmed_at || null, job.id],
        );
        if (!r.changes) throw conflict("Another partner already took this job.");
        if (myOffer) await t.run(`UPDATE job_offers SET status = 'accepted', decided_at = $1 WHERE id = $2`, [at, myOffer.id]);
        await t.run(`UPDATE job_offers SET status = 'expired', decided_at = $1 WHERE job_id = $2 AND status = 'pending'`, [at, job.id]);
        await event(t, job.id, user.id, "accepted", { partnerId: user.id });
        if (!job.approve_partner) await event(t, job.id, user.id, "confirmed", null);
        const pname = await firstName(t, user.id);
        if (job.approve_partner) {
          await tell(t, job.customer_id, { category: "booking", title: "Approve your partner", body: `${pname} wants your ${svcNames(job)} visit. Answer within ${sameDay ? s.approveNow : s.approveLater} minutes or we'll offer it to the next partner.`, data: jobRoute(job.id) });
        } else {
          await tell(t, job.customer_id, { category: "booking", title: job.comeback_of ? "Warranty return confirmed" : "Your visit is confirmed", body: `${pname} is booked for your ${svcNames(job)}${job.kind === "scheduled" ? ` on ${fmtWhen(job.window_start)}` : ""}.`, data: jobRoute(job.id) });
        }
        return partnerView(t, await getJob(t, job.id), user.id);
      });
    },

    // ---------- Step 3: Customer approves (only if they asked to) ----------
    async decidePartner(user, id, approve) {
      return db.tx(async (t) => {
        const job = await forCustomer(t, user, id);
        need(job, ["awaiting_approval"], "There's no partner waiting for your answer on this job.");
        if (job.approval_deadline <= now()) throw conflict("The time to answer ran out, so we're finding another partner.");
        if (approve) {
          await update(t, job, { status: "confirmed", confirmed_at: now(), approval_deadline: null });
          await event(t, job.id, user.id, "partner_approved", { partnerId: job.partner_id });
          await event(t, job.id, user.id, "confirmed", null);
          await tell(t, job.partner_id, { category: "jobs", title: "You're confirmed", body: `The customer approved you for ${svcNames(job)}${job.kind === "scheduled" ? ` on ${fmtWhen(job.window_start)}` : ""}.`, data: jobRoute(job.id) });
        } else {
          await releaseToRequested(t, job, { exclude: job.partner_id, kind: "partner_declined_by_customer", actorId: user.id, data: { partnerId: job.partner_id } });
          await tell(t, job.partner_id, { category: "jobs", title: "The customer picked someone else", body: `The ${svcNames(job)} job went to another partner. Nothing counts against you.`, data: { route: "/home" } });
        }
        return customerView(t, await getJob(t, job.id));
      });
    },

    // ---------- Step 5: On the way ----------
    async startTrip(user, id) {
      return db.tx(async (t) => {
        const job = await forPartner(t, user, id);
        need(job, ["confirmed"], "You can start the trip once the job is confirmed.");
        const earliest = job.window_start - START_TRIP_EARLY_HOURS * HOUR;
        if (now() < earliest) throw conflict(`You can start the trip up to ${START_TRIP_EARLY_HOURS} hours before the arrival window.`);
        await update(t, job, { status: "en_route", trip_started_at: now() });
        await event(t, job.id, user.id, "trip_started", null);
        await tell(t, job.customer_id, { category: "on_the_way", title: `${await firstName(t, user.id)} is on the way`, body: `Your partner started driving to you for ${svcNames(job)}. Have the vehicle ready and unlocked if you can.`, data: jobRoute(job.id) });
        return partnerView(t, await getJob(t, job.id), user.id);
      });
    },

    // ---------- Step 6: Arrived & check-in ----------
    async arrive(user, id) {
      return db.tx(async (t) => {
        const job = await forPartner(t, user, id);
        need(job, ["en_route"], "Start the trip before marking that you've arrived.");
        await update(t, job, { status: "arrived", arrived_at: now() });
        await event(t, job.id, user.id, "arrived", null);
        await tell(t, job.customer_id, { category: "on_the_way", title: `${await firstName(t, user.id)} has arrived`, body: "Your partner is photographing the vehicle before starting. If you're not there, reply in the app's chat.", data: jobRoute(job.id) });
        return partnerView(t, await getJob(t, job.id), user.id);
      });
    },

    async checkIn(user, id, b) {
      return db.tx(async (t) => {
        const job = await forPartner(t, user, id);
        need(job, ["arrived"], "Mark that you've arrived before checking in.");
        if (photos && requirePhotos) {
          const missing = await photos.missing(job.id, "checkin");
          if (missing) throw conflict(`Take all 12 check-in photos before starting work. Still needed: ${missing.join(", ")}.`);
        }
        const odo = typeof b.odometer === "number" ? b.odometer : Number(String(b.odometer ?? "").replace(/[,\s]/g, ""));
        if (!Number.isInteger(odo) || odo < 0 || odo > 1_500_000) throw bad("odometer", "Enter the odometer reading as a whole number of miles.");
        await update(t, job, { status: "in_progress", odometer_in: odo, work_started_at: now() });
        const v = await t.get(`SELECT mileage FROM vehicles WHERE id = $1`, [job.vehicle_id]);
        if (v.mileage == null || odo > v.mileage) await t.run(`UPDATE vehicles SET mileage = $1, updated_at = $2 WHERE id = $3`, [odo, now(), job.vehicle_id]);
        await event(t, job.id, user.id, "checked_in", { odometer: odo, note: "Check-in photos are added with step 10." });
        return partnerView(t, await getJob(t, job.id), user.id);
      });
    },

    async noShow(user, id) {
      await db.tx(async (t) => {
        const job = await forPartner(t, user, id);
        need(job, ["arrived"], "You can only mark a no-show after you've arrived.");
        const allowedAt = job.arrived_at + NO_SHOW_WAIT_MIN * MIN;
        if (now() < allowedAt) throw conflict(`Call and text the customer through the app, then wait ${NO_SHOW_WAIT_MIN} minutes after arriving before marking a no-show.`);
        const s = await settingsFor(job.settings_version);
        const fee = Math.round(s.enroute * 100);
        await update(t, job, { status: "cancelled", cancelled_at: now(), cancelled_by: "customer", cancel_reason: "no_show", cancel_fee_cents: fee, partner_comp_cents: partnerShare(fee, s) });
        await event(t, job.id, user.id, "no_show", { feeCents: fee, partnerCompCents: partnerShare(fee, s) });
        await tell(t, job.customer_id, { category: "booking", title: "Marked as a no-show", body: `Your partner waited ${NO_SHOW_WAIT_MIN} minutes and couldn't reach you or the vehicle, so the ${fmtMoney(fee)} no-show fee applies. Contact support if that's wrong.`, data: jobRoute(job.id) });
      });
      await money(id, (job) => payments.afterCancel(job));
      return db.tx(async (t) => partnerView(t, await getJob(t, id), user.id));
    },

    // ---------- Step 7: Working — add-ons and glass quotes need the customer's OK ----------
    async requestAddons(user, id, b) {
      return db.tx(async (t) => {
        const job = await forPartner(t, user, id);
        need(job, ["in_progress"], "Add-ons can be requested once you've checked in.");
        if (job.comeback_of) throw conflict("Warranty returns are free for the customer. If they need other work, they can book it as a new visit.");
        const ids = checkServiceIds(b.serviceIds, "serviceIds", 5);
        const reason = typeof b.reason === "string" ? b.reason.trim() : "";
        if (reason.length < 5) throw bad("reason", "Tell the customer what you found and why it needs doing.");
        if (reason.length > 300) throw bad("reason", "Keep the reason under 300 characters.");
        const existing = new Set([...J(job.service_ids, []), ...(await t.all(`SELECT service_id FROM job_addons WHERE job_id = $1 AND status IN ('pending','approved')`, [job.id])).map((r) => r.service_id)]);
        const dup = ids.find((x) => existing.has(x));
        if (dup) throw bad("serviceIds", `${serviceById(dup).name} is already on this job.`);
        const vehicle = vehicleOut(await t.get(`SELECT * FROM vehicles WHERE id = $1`, [job.vehicle_id]));
        const s = await settingsFor(job.settings_version);
        const lines = priceAll(ids, vehicle, s);
        if (lines.some((l) => l.priceCents == null)) throw bad("serviceIds", "Glass replacements are quoted separately. Use Send glass quote.");
        for (const l of lines) {
          await t.run(`INSERT INTO job_addons (id, job_id, kind, service_id, reason, line, status, created_at) VALUES ($1, $2, 'addon', $3, $4, $5, 'pending', $6)`, [newId(), job.id, l.serviceId, reason, JSON.stringify(l), now()]);
        }
        await event(t, job.id, user.id, "addons_requested", { serviceIds: ids, totalCents: lines.reduce((a, l) => a + l.priceCents, 0) });
        await tell(t, job.customer_id, { category: "addons", title: "Approve added work?", body: `${await firstName(t, user.id)} found something: "${reason.slice(0, 120)}" ${lines.map((l) => l.name).join(", ")} for ${fmtMoney(lines.reduce((a, l) => a + l.priceCents, 0))}. Nothing extra happens until you answer.`, data: jobRoute(job.id) });
        return partnerView(t, await getJob(t, job.id), user.id);
      });
    },

    async glassQuote(user, id, b) {
      return db.tx(async (t) => {
        const job = await forPartner(t, user, id);
        need(job, ["confirmed", "en_route", "arrived", "in_progress"], "Send the glass quote once the job is confirmed.");
        const serviceId = String(b.serviceId || "");
        const quote = J(job.quote);
        if (!quote.pending.some((p) => p.serviceId === serviceId)) throw bad("serviceId", "This job doesn't have that glass replacement.");
        const open = await t.get(`SELECT id FROM job_addons WHERE job_id = $1 AND service_id = $2 AND status IN ('pending','approved')`, [job.id, serviceId]);
        if (open) throw conflict("You already sent a quote for this glass. Wait for the customer's answer.");
        const cost = Number(b.glassCost);
        if (!Number.isFinite(cost) || cost <= 0 || cost > 10000) throw bad("glassCost", "Enter the glass cost from your supplier, like 289.50.");
        const partNumber = typeof b.partNumber === "string" ? b.partNumber.trim().slice(0, 40) : "";
        const supplier = typeof b.supplier === "string" ? b.supplier.trim().slice(0, 60) : "";
        if (!partNumber) throw bad("partNumber", "Enter the glass part number.");
        if (!supplier) throw bad("supplier", "Enter the supplier.");
        const vehicle = vehicleOut(await t.get(`SELECT * FROM vehicles WHERE id = $1`, [job.vehicle_id]));
        const s = await settingsFor(job.settings_version);
        const q = glassQuote({ serviceId, glassCostCents: Math.round(cost * 100), needsCalibration: b.needsCalibration === true, vehicle }, s);
        const note = typeof b.note === "string" ? b.note.trim().slice(0, 300) : "";
        if (q.needsSupplierQuote && note.length < 5) throw bad("note", "This is above the typical price. Add a note explaining why (the supplier's quote upload comes with photos).");
        const line = { ...q, category: "glass", kind: "glass", partNumber, supplier };
        await t.run(`INSERT INTO job_addons (id, job_id, kind, service_id, reason, line, status, created_at) VALUES ($1, $2, 'glass', $3, $4, $5, 'pending', $6)`, [newId(), job.id, serviceId, note || null, JSON.stringify(line), now()]);
        await event(t, job.id, user.id, "glass_quote_sent", { serviceId, priceCents: q.priceCents });
        await tell(t, job.customer_id, { category: "addons", title: "Your glass quote is ready", body: `${q.name || "Glass"}: ${fmtMoney(q.priceCents)}. Nothing is ordered until you approve. Declining is free.`, data: jobRoute(job.id) });
        return partnerView(t, await getJob(t, job.id), user.id);
      });
    },

    async decideAddon(user, id, addonId, approve) {
      const view = await db.tx(async (t) => {
        const job = await forCustomer(t, user, id);
        const a = await t.get(`SELECT * FROM job_addons WHERE id = $1 AND job_id = $2`, [String(addonId), job.id]);
        if (!a) throw notFound();
        if (a.status !== "pending") throw conflict("You already answered this request.");
        need(job, ["confirmed", "en_route", "arrived", "in_progress"], "This job isn't active anymore.");
        await t.run(`UPDATE job_addons SET status = $1, decided_at = $2 WHERE id = $3`, [approve ? "approved" : "declined", now(), a.id]);
        await event(t, job.id, user.id, approve ? `${a.kind}_approved` : `${a.kind}_declined`, { serviceId: a.service_id });
        await tell(t, job.partner_id, { category: "jobs", title: `${a.kind === "glass" ? "Glass quote" : "Add-on"} ${approve ? "approved" : "declined"}`, body: `${J(a.line).name}: the customer ${approve ? "approved it. Go ahead." : "said no. Finish the original job only."}`, data: jobRoute(job.id) });
        // Declining glass is free for both. If nothing else is left on the job, it ends with no charge.
        if (!approve && a.kind === "glass") {
          const quote = J(job.quote);
          const otherPending = quote.pending.filter((p) => p.serviceId !== a.service_id);
          const approvedGlass = await t.get(`SELECT id FROM job_addons WHERE job_id = $1 AND kind = 'glass' AND status = 'approved'`, [job.id]);
          if (!quote.lines.length && !otherPending.length && !approvedGlass) {
            await update(t, job, { status: "cancelled", cancelled_at: now(), cancelled_by: "customer", cancel_reason: "glass_quote_declined", cancel_fee_cents: 0 });
            await event(t, job.id, user.id, "cancelled", { feeCents: 0, reason: "Glass quote declined. No charge for either side." });
          }
        }
        return customerView(t, await getJob(t, job.id));
      });
      if (view.status !== "cancelled") return view;
      await money(view.id, (job) => payments.afterCancel(job));
      return db.tx(async (t) => customerView(t, await getJob(t, view.id)));
    },

    // ---------- Steps 8 and 9: Wrap-up and Completed ----------
    async complete(user, id, b) {
      await db.tx(async (t) => {
        const job = await forPartner(t, user, id);
        need(job, ["in_progress"], "Check in before completing the job.");
        if (photos && requirePhotos) {
          const missing = await photos.missing(job.id, "after");
          if (missing) throw conflict(`Take both after photos before completing. Still needed: ${missing.join(", ")}.`);
        }
        const ins = b.inspection;
        if (!ins || typeof ins !== "object") throw bad("inspection", "Fill in the 8-item inspection report.");
        const clean = {};
        const missing = [];
        for (const k of INSPECTION_ITEMS) {
          const item = ins[k];
          const st = item && item.status;
          if (!["good", "soon", "now"].includes(st)) { missing.push(INSPECTION_LABELS[k]); continue; }
          const note = typeof item.note === "string" ? item.note.trim().slice(0, 200) : "";
          if (st !== "good" && note.length < 3) { missing.push(`${INSPECTION_LABELS[k]} (add a note)`); continue; }
          clean[k] = { status: st, note: note || null };
        }
        if (missing.length) throw bad("inspection", `Finish the inspection report: ${missing.join(", ")}.`);
        const pendingGlass = await t.get(`SELECT id FROM job_addons WHERE job_id = $1 AND kind = 'glass' AND status = 'pending'`, [job.id]);
        if (pendingGlass) throw conflict("The customer hasn't answered the glass quote yet. Wait for their answer before completing.");
        const workNotes = typeof b.notes === "string" ? b.notes.trim().slice(0, 1000) || null : null;
        const at = now();
        // Unanswered add-ons expire: the partner finishes the original job only.
        await t.run(`UPDATE job_addons SET status = 'expired', decided_at = $1 WHERE job_id = $2 AND status = 'pending'`, [at, job.id]);

        const s = await settingsFor(job.settings_version);
        const quote = J(job.quote);
        if (job.comeback_of) {
          // Warranty return: no charge. Pay goes to a different partner only, charged back to the original one.
          const same = job.partner_id === job.comeback_partner_id;
          const pay = same ? zeroPay(s) : partnerPay(quote.payLines || [], s, { mobile: true });
          const final = { lines: quote.lines, fees: [], servicesCents: 0, totalCents: 0, creditsCents: 0, chargeCents: 0, partnerPay: pay, settingsVersion: job.settings_version, warranty: true };
          const orig = await getJob(t, job.comeback_of);
          await update(t, job, { status: "completed", completed_at: at, inspection: JSON.stringify(clean), work_notes: workNotes, final: JSON.stringify(final), warranty_until: orig.warranty_until, warranty_miles_until: orig.warranty_miles_until });
          await event(t, job.id, user.id, "completed", { chargeCents: 0, partnerEarningsCents: pay.earningsCents, warranty: true });
          const w = await t.get(`SELECT * FROM warranty_returns WHERE return_job_id = $1`, [job.id]);
          const cost = pay.earningsCents + pay.partsReimbursedCents;
          if (!same && cost > 0 && w) {
            await t.run(`INSERT INTO partner_debts (id, partner_id, reason, job_id, cents, waived_at, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
              [newId(), job.comeback_partner_id, `Warranty return done by another partner`, job.id, cost, w.charge_back ? null : at, at]);
            if (w.charge_back) await tell(t, job.comeback_partner_id, { category: "claims", title: `Warranty charge-back: ${fmtMoney(cost)}`, body: `Another partner redid your ${svcNames(orig)} under warranty. ${fmtMoney(cost)} comes out of future payouts, never more than ${s.recoverMax}% of any one.`, data: { route: "/payouts" } });
          }
          await tell(t, job.customer_id, { category: "receipts", title: "Warranty return done", body: `${await firstName(t, user.id)} finished your warranty return. There's no charge. Rate the visit in the app.`, data: jobRoute(job.id) });
          return;
        }
        const approved = (await t.all(`SELECT * FROM job_addons WHERE job_id = $1 AND status = 'approved' ORDER BY created_at`, [job.id])).map((a) => J(a.line));
        const lines = [...quote.lines, ...approved];
        const ids = J(job.service_ids, []);
        const diagCredit = ids.includes("diagnostics") && approved.some((l) => l.kind !== "glass");
        const total = customerTotal(lines, s, { mobile: true, diagCredit });
        const rescheduleFees = (await t.all(`SELECT data FROM job_events WHERE job_id = $1 AND kind = 'rescheduled'`, [job.id])).reduce((a, e) => a + ((J(e.data) || {}).feeCents || 0), 0);
        if (rescheduleFees) {
          total.fees.push({ id: "reschedule", label: "Reschedule fee", cents: rescheduleFees });
          total.totalCents += rescheduleFees;
        }
        // Apply account credits, oldest first.
        let creditsCents = 0;
        const credits = await t.all(`SELECT * FROM customer_credits WHERE user_id = $1 AND used_at IS NULL ORDER BY created_at`, [job.customer_id]);
        for (const c of credits) {
          if (creditsCents + c.cents > total.totalCents) break;
          creditsCents += c.cents;
          await t.run(`UPDATE customer_credits SET used_at = $1, used_on_job_id = $2 WHERE id = $3`, [at, job.id, c.id]);
        }
        const pay = partnerPay(lines, s, { mobile: true });
        const final = {
          lines, fees: total.fees, servicesCents: total.servicesCents, totalCents: total.totalCents, creditsCents,
          chargeCents: total.totalCents - creditsCents, partnerPay: pay, settingsVersion: job.settings_version,
        };
        const until = new Date(at);
        until.setMonth(until.getMonth() + s.warrantyMo);
        await update(t, job, {
          status: "completed", completed_at: at, inspection: JSON.stringify(clean), work_notes: workNotes, final: JSON.stringify(final),
          warranty_until: until.getTime(), warranty_miles_until: job.odometer_in != null ? job.odometer_in + s.warrantyMi : null,
        });
        await event(t, job.id, user.id, "completed", { chargeCents: final.chargeCents, partnerEarningsCents: pay.earningsCents });
        const receipt = [...final.lines.map((l) => `${l.name}: ${fmtMoney(l.priceCents)}`), ...final.fees.map((f) => `${f.label}: ${fmtMoney(f.cents)}`),
          `Total: ${fmtMoney(final.totalCents)}`, ...(final.creditsCents ? [`Account credit: -${fmtMoney(final.creditsCents)}`, `You pay: ${fmtMoney(final.chargeCents)}`] : [])].join("\n");
        await tell(t, job.customer_id, {
          category: "receipts", title: "Your visit is done", body: `${fmtMoney(final.chargeCents)} for ${svcNames(job)}. Rate ${await firstName(t, user.id)} and add a tip within 24 hours if you'd like.`,
          data: jobRoute(job.id), emailText: `Your ${svcNames(job)} visit is done. Here's your receipt:\n\n${receipt}\n\nYour repair is under warranty until ${new Date(until.getTime()).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}${job.odometer_in != null ? ` or ${(job.odometer_in + s.warrantyMi).toLocaleString("en-US")} miles` : ""}, whichever comes first.`,
        });
      });
      // The partner's pay goes to their ledger no matter what; then the customer's card is charged.
      await money(id, (job) => payments.afterComplete(job));
      const done = await db.get(`SELECT * FROM jobs WHERE id = $1`, [String(id)]);
      if (done.payment_status === "charge_failed") {
        await tell(db, done.customer_id, { category: "receipts", title: "Your card was declined", body: `We couldn't charge ${fmtMoney(J(done.final).chargeCents)} for your visit. Open the visit in the app and tap Pay now, or add another card.`, data: jobRoute(done.id) });
      }
      return db.tx(async (t) => partnerView(t, await getJob(t, id), user.id));
    },

    // ---------- Cancellations and changes ----------
    async cancelByCustomer(user, id, b) {
      await db.tx(async (t) => {
        const job = await forCustomer(t, user, id);
        need(job, ["requested", "awaiting_approval", "confirmed", "en_route", "arrived"], job.status === "in_progress" ? "Your partner already started the work. Talk to them in the app, or contact support." : "This job can't be cancelled anymore.");
        const s = await settingsFor(job.settings_version);
        const fee = customerCancelFee(job, s);
        if (b.expectedFeeCents != null && Number(b.expectedFeeCents) !== fee.cents) throw conflict("The cancellation fee changed while you were deciding. Check the new amount and try again.");
        const comp = job.partner_id && fee.cents ? partnerShare(fee.cents, s) : 0;
        const reason = typeof b.reason === "string" ? b.reason.trim().slice(0, 200) || null : null;
        await update(t, job, { status: "cancelled", cancelled_at: now(), cancelled_by: "customer", cancel_reason: reason, cancel_fee_cents: fee.cents, partner_comp_cents: comp });
        await event(t, job.id, user.id, "cancelled", { by: "customer", feeCents: fee.cents, partnerCompCents: comp, reason });
        if (job.partner_id) await tell(t, job.partner_id, { category: "jobs", title: "The customer cancelled", body: `The ${svcNames(job)} job${job.kind === "scheduled" ? ` on ${fmtWhen(job.window_start)}` : ""} is cancelled.${comp ? ` You keep ${fmtMoney(comp)} of their fee.` : ""}`, data: jobRoute(job.id) });
      });
      await money(id, (job) => payments.afterCancel(job));
      return db.tx(async (t) => customerView(t, await getJob(t, id)));
    },

    async cancelByPartner(user, id, b) {
      return db.tx(async (t) => {
        const job = await forPartner(t, user, id);
        need(job, ["awaiting_approval", "confirmed", "en_route"], job.status === "arrived" || job.status === "in_progress" ? "You're already at the job. If the customer isn't there, use No-show. Otherwise contact partner support." : "This job can't be cancelled.");
        const s = await settingsFor(job.settings_version);
        const late = job.window_start - now() <= s.pcxFreeHrs * HOUR;
        const reason = typeof b.reason === "string" ? b.reason.trim().slice(0, 200) || null : null;
        if (late) {
          await t.run(`INSERT INTO customer_credits (id, user_id, cents, reason, job_id, created_at) VALUES ($1, $2, $3, $4, $5, $6)`,
            [newId(), job.customer_id, Math.round(s.pcxCredit * 100), "Your partner cancelled close to the visit", job.id, now()]);
          await event(t, job.id, user.id, "partner_late_cancel", { partnerId: user.id, creditCents: Math.round(s.pcxCredit * 100), reason });
          const n = Number((await t.get(`SELECT COUNT(*) AS n FROM job_events WHERE actor_id = $1 AND kind = 'partner_late_cancel' AND created_at > $2`, [user.id, now() - 30 * DAY])).n);
          if (n >= s.lateCxReview) await t.run(`UPDATE partner_profiles SET review_reason = $1, updated_at = $2 WHERE user_id = $3`, [`${n} late cancels in 30 days`, now(), user.id]);
        }
        // The job goes back out, first in line. A warranty return just goes to everyone.
        if (job.comeback_of && job.comeback_partner_id === user.id) {
          await update(t, job, { status: "requested", partner_id: null, accepted_at: null, confirmed_at: null, approval_deadline: null });
          await warrantyToBoard(t, await getJob(t, job.id), { kind: "partner_cancelled", note: "The original partner cancelled.", actorId: user.id });
        } else {
          await releaseToRequested(t, job, { exclude: user.id, kind: "partner_cancelled", actorId: user.id, data: { partnerId: user.id, late, reason } });
          await tell(t, job.customer_id, { category: "booking", title: "Your partner cancelled", body: `We're finding you another partner for ${svcNames(job)} right away.${late ? ` We added a ${fmtMoney(Math.round(s.pcxCredit * 100))} credit to your account for the trouble.` : ""}`, data: jobRoute(job.id) });
        }
        const after = await getJob(t, job.id);
        return { late, lateCancelsCount: late ? Number((await t.get(`SELECT COUNT(*) AS n FROM job_events WHERE actor_id = $1 AND kind = 'partner_late_cancel' AND created_at > $2`, [user.id, now() - 30 * DAY])).n) : null, jobStatus: after.status };
      });
    },

    async reschedule(user, id, b) {
      await db.tx(async (t) => {
        const job = await forCustomer(t, user, id);
        need(job, ["requested", "awaiting_approval", "confirmed"], "This job can't be rescheduled now.");
        if (job.kind !== "scheduled") throw conflict("As-soon-as-possible and roadside requests can't be rescheduled. Cancel and book a scheduled visit instead.");
        const start = parseTime(b.windowStart, "windowStart");
        const at = now();
        if (start < at + EARLIEST_BOOKING_HOURS * HOUR) throw bad("windowStart", `Pick a time at least ${EARLIEST_BOOKING_HOURS} hours from now.`);
        if (start > at + LATEST_BOOKING_DAYS * DAY) throw bad("windowStart", `You can book up to ${LATEST_BOOKING_DAYS} days ahead.`);
        const s = await settingsFor(job.settings_version);
        const late = partnerLate(job);
        const feeCents = late || job.reschedule_count < FREE_RESCHEDULES ? 0 : Math.round(s.late * 100);
        if (b.expectedFeeCents != null && Number(b.expectedFeeCents) !== feeCents) throw conflict("The reschedule fee changed. Check the new amount and try again.");
        await update(t, job, {
          window_start: start, window_end: start + SCHEDULED_WINDOW_HOURS * HOUR, request_expires_at: job.status === "requested" ? start : job.request_expires_at,
          reschedule_count: late ? job.reschedule_count : job.reschedule_count + 1,
        });
        if (late) {
          await t.run(`INSERT INTO customer_credits (id, user_id, cents, reason, job_id, created_at) VALUES ($1, $2, $3, $4, $5, $6)`,
            [newId(), job.customer_id, LATE_PARTNER_CREDIT_CENTS, "Your partner was late to leave", job.id, at]);
        }
        await event(t, job.id, user.id, "rescheduled", { from: job.window_start, to: start, feeCents, partnerLate: late, creditCents: late ? LATE_PARTNER_CREDIT_CENTS : 0 });
        if (job.partner_id && job.status !== "requested") await tell(t, job.partner_id, { category: "jobs", title: "A visit was rescheduled", body: `${svcNames(job)} moved from ${fmtWhen(job.window_start)} to ${fmtWhen(start)}. If you can't make the new time, release it in the app.`, data: jobRoute(job.id) });
      });
      await money(id, async (job) => payments.afterReschedule(job, (await settings.current()).settings));
      return db.tx(async (t) => customerView(t, await getJob(t, id)));
    },

    async switchPartner(user, id) {
      return db.tx(async (t) => {
        const job = await forCustomer(t, user, id);
        if (!partnerLate(job)) throw conflict(`You can switch partners if yours hasn't left ${PARTNER_LATE_MIN} minutes before the window starts.`);
        await releaseToRequested(t, job, { exclude: job.partner_id, kind: "switched_partner", actorId: user.id, data: { partnerId: job.partner_id, note: "Partner hadn't left in time." } });
        return customerView(t, await getJob(t, job.id));
      });
    },

    // ---------- Warranty returns (free comeback visit while the warranty is active) ----------
    async requestWarranty(user, originalId, b) {
      let orig = await db.get(`SELECT * FROM jobs WHERE id = $1`, [String(originalId)]);
      if (!orig || orig.customer_id !== user.id) throw notFound();
      if (orig.comeback_of) orig = await db.get(`SELECT * FROM jobs WHERE id = $1`, [orig.comeback_of]);
      if (orig.status !== "completed" || !orig.partner_id) throw conflict("Warranty returns are for finished visits.");
      if (!orig.warranty_until || orig.warranty_until <= now()) throw conflict(`The warranty on this repair ended${orig.warranty_until ? ` on ${new Date(orig.warranty_until).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}` : ""}. Book a new visit instead.`);
      const open = await db.get(`SELECT id FROM jobs WHERE comeback_of = $1 AND status IN ('requested','awaiting_approval','confirmed','en_route','arrived','in_progress')`, [orig.id]);
      if (open) throw conflict("You already have a warranty return booked for this repair. Open it from Your visits.");
      if (!WARRANTY_ISSUES[b.issue]) throw bad("issue", "Tell us what's happening.");
      const details = typeof b.details === "string" ? b.details.trim().slice(0, 1000) || null : null;
      const start = parseTime(b.windowStart, "windowStart");
      const at = now();
      if (start < at + EARLIEST_BOOKING_HOURS * HOUR) throw bad("windowStart", `Pick a time at least ${EARLIEST_BOOKING_HOURS} hours from now.`);
      if (start > at + LATEST_BOOKING_DAYS * DAY) throw bad("windowStart", `You can book up to ${LATEST_BOOKING_DAYS} days ahead.`);
      const place = await db.get(`SELECT * FROM places WHERE id = $1 AND user_id = $2 AND archived_at IS NULL`, [String(b.placeId || orig.place_id), user.id]);
      if (!place) throw bad("placeId", "Choose where we should meet you.");
      const vehicle = await db.get(`SELECT id FROM vehicles WHERE id = $1 AND user_id = $2 AND archived_at IS NULL`, [orig.vehicle_id, user.id]);
      if (!vehicle) throw conflict("That vehicle was removed from your account. Add it again, then try.");
      const files = photos ? photos.decodeAll(b.photos, "photos", { max: 4 }) : [];
      const cur = await settings.current();
      const s = cur.settings;
      const payLines = J(orig.final, {}).lines || [];
      const lines = payLines.map((l) => ({ serviceId: l.serviceId, name: l.name, category: l.category, hours: l.hours, priceCents: 0 }));
      const quote = { lines, pending: [], servicesCents: 0, fees: [], totalCents: 0, depositCents: 0, holdCents: 0, holdHoursBefore: s.holdHrs, shopCompareCents: null, savingsCents: null, warranty: true, payLines };
      const original = await db.get(`SELECT status FROM partner_profiles WHERE user_id = $1`, [orig.partner_id]);
      const originalCan = original && original.status === "active" && !(onboarding && (await onboarding.coverageProblem(orig.partner_id)));
      const where = await locateJob(place);
      const id = newId();
      const wid = newId();
      await db.tx(async (t) => {
        await t.run(
          `INSERT INTO jobs (id, customer_id, vehicle_id, place_id, kind, status, service_ids, settings_version, quote, notes, window_start, window_end, request_expires_at, approve_partner, lat, lng, dispatch_phase,
             comeback_of, comeback_partner_id, offer_until, excluded_partners, priority, created_at, updated_at)
           VALUES ($1, $2, $3, $4, 'scheduled', 'requested', $5, $6, $7, $8, $9, $10, $9, 0, $11, $12, $13, $14, $15, $16, $17, 1, $18, $18)`,
          [id, user.id, orig.vehicle_id, place.id, JSON.stringify(payLines.map((l) => l.serviceId)), cur.version, JSON.stringify(quote), details ? `Warranty return: ${WARRANTY_ISSUES[b.issue]}. ${details}` : `Warranty return: ${WARRANTY_ISSUES[b.issue]}.`,
            start, start + SCHEDULED_WINDOW_HOURS * HOUR, where.lat, where.lng, originalCan ? "warranty" : "board", orig.id, orig.partner_id,
            originalCan ? Math.min(at + WARRANTY_OFFER_HOURS * HOUR, start - HOUR) : null, JSON.stringify(originalCan ? [] : [orig.partner_id]), at],
        );
        await t.run(`INSERT INTO warranty_returns (id, original_job_id, return_job_id, customer_id, original_partner_id, issue, details, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [wid, orig.id, id, user.id, orig.partner_id, b.issue, details, at]);
        if (photos) await photos.attach(t, "warranty", wid, files, user);
        await event(t, id, user.id, "warranty_requested", { originalJobId: orig.id, issue: b.issue });
        await event(t, orig.id, user.id, "warranty_return_requested", { returnJobId: id });
        if (originalCan) {
          await tell(t, orig.partner_id, { category: "claims", title: "Warranty return request", body: `Your ${new Date(orig.completed_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })} ${svcNames(orig)} customer reports: ${WARRANTY_ISSUES[b.issue]}. They asked for ${fmtWhen(start)}. Accept it in the app within ${WARRANTY_OFFER_HOURS} hours, or it goes to another partner and is charged back to you.`, data: { route: "/job", params: { id } } });
        } else {
          await event(t, id, null, "warranty_to_board", { note: "The original partner isn't taking jobs right now." });
        }
      });
      return db.tx(async (t) => customerView(t, await getJob(t, id)));
    },

    // The original partner can't do the warranty return: it goes to other partners (and is charged back).
    async declineWarranty(user, id) {
      return db.tx(async (t) => {
        const job = await getJob(t, id);
        if (!job || job.comeback_partner_id !== user.id || job.status !== "requested" || job.dispatch_phase !== "warranty") throw conflict("This warranty return isn't waiting for you.");
        await warrantyToBoard(t, job, { kind: "warranty_declined", note: "The original partner can't make it.", actorId: user.id });
        return { ok: true };
      });
    },

    async addonsOf(id) { return addonsOf(db, id); },
    rawJob: (id) => db.get(`SELECT * FROM jobs WHERE id = $1`, [String(id)]),

    // Addresses saved before the Google key was added get their map location now (runs once at startup).
    async backfillLocations(log = () => {}) {
      if (!geocode) return { places: 0, areas: 0 };
      let places = 0, areas = 0;
      for (const p of await db.all(`SELECT * FROM places WHERE geo_status IS NULL AND archived_at IS NULL LIMIT 1000`)) {
        const g = await geocode(addressLine(p));
        await db.run(`UPDATE places SET lat = $1, lng = $2, geo_status = $3 WHERE id = $4`, [g.lat ?? null, g.lng ?? null, g.status, p.id]);
        if (g.status === "ok") places++;
      }
      for (const a of await db.all(`SELECT * FROM partner_service_areas WHERE geo_status IS NULL OR geo_status = 'error' LIMIT 1000`)) {
        const g = await geocode(addressLine(a));
        await db.run(`UPDATE partner_service_areas SET lat = $1, lng = $2, geo_status = $3 WHERE user_id = $4`, [g.lat ?? null, g.lng ?? null, g.status, a.user_id]);
        if (g.status === "ok") areas++;
      }
      if (places || areas) log(`[maps] located ${places} places and ${areas} service areas`);
      return { places, areas };
    },

    // ---------- Offers (instant jobs, one partner at a time) ----------
    async offersFor(user) {
      const rows = await db.all(`SELECT o.*, j.status AS job_status FROM job_offers o JOIN jobs j ON j.id = o.job_id WHERE o.partner_id = $1 AND o.status = 'pending' AND o.expires_at > $2 ORDER BY o.sent_at`, [user.id, now()]);
      return db.tx(async (t) => Promise.all(rows.map(async (o) => ({
        offerId: o.id, expiresAt: o.expires_at, secondsLeft: Math.max(0, Math.round((o.expires_at - now()) / 1000)), distanceMiles: o.distance_miles,
        job: await partnerView(t, await getJob(t, o.job_id), user.id),
      }))));
    },

    async declineOffer(user, id) {
      return db.tx(async (t) => {
        const o = await t.get(`SELECT * FROM job_offers WHERE job_id = $1 AND partner_id = $2 AND status = 'pending'`, [String(id), user.id]);
        if (!o) throw conflict("This offer already ended.");
        await t.run(`UPDATE job_offers SET status = 'declined', decided_at = $1 WHERE id = $2`, [now(), o.id]);
        await event(t, o.job_id, user.id, "offer_declined", { partnerId: user.id });
        await dispatchNext(t, await getJob(t, o.job_id));
        return { ok: true };
      });
    },

    // ---------- In-app chat. Real phone numbers are never shared. ----------
    async messages(user, id) {
      return db.tx(async (t) => {
        const job = await chatJob(t, user, id);
        const rows = await t.all(`SELECT * FROM job_messages WHERE job_id = $1 ORDER BY id LIMIT 500`, [job.id]);
        return { messages: rows.map((m) => ({ id: m.id, mine: m.sender_id === user.id, from: m.sender_role, body: m.body, at: m.created_at })), canSend: chatOpen(job) };
      });
    },

    async sendMessage(user, id, b) {
      return db.tx(async (t) => {
        const job = await chatJob(t, user, id);
        if (!chatOpen(job)) throw conflict("Messages for this job are closed.");
        const body = typeof b.body === "string" ? b.body.trim() : "";
        if (!body) throw bad("body", "Type a message.");
        if (body.length > 1000) throw bad("body", "Keep messages under 1,000 characters.");
        const masked = maskContacts(body);
        const mid = eventId();
        await t.run(`INSERT INTO job_messages (id, job_id, sender_id, sender_role, body, created_at) VALUES ($1, $2, $3, $4, $5, $6)`, [mid, job.id, user.id, user.role, masked, now()]);
        const to = user.id === job.customer_id ? job.partner_id : job.customer_id;
        await tell(t, to, { category: "messages", title: `Message from ${await firstName(t, user.id)}`, body: masked.slice(0, 160), data: { route: "/chat", params: { id: job.id } } });
        return { id: mid, body: masked, hidden: masked !== body };
      });
    },
  };
}
