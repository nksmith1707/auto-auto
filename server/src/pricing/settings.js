// Pricing & rules settings: the numbers RULES.md marks *setting*. Same keys, labels, and starting values as the
// Ops Console prototype. Stored as numbered versions; a change is a new version with a note.
import { HttpError } from "../lib/http.js";

// [key, label, unit, hint, { min, max, int }]
export const META = [
  ["labor", "Labor rate", "$/hr", "Book time × this rate = labor on every quote", { min: 1, max: 500 }],
  ["shopLabor", "Typical shop rate", "$/hr", "Shown to customers for comparison (local shops: $120–$159)", { min: 1, max: 500 }],
  ["mk50", "Parts markup · under $50", "%", "Shops: 90–300%", { min: 0, max: 300 }],
  ["mk200", "Parts markup · $50–200", "%", "Shops: 65–90%", { min: 0, max: 300 }],
  ["mk500", "Parts markup · $200–500", "%", "Shops: 45–60%", { min: 0, max: 300 }],
  ["mkTop", "Parts markup · over $500", "%", "Shops: 20–40%", { min: 0, max: 300 }],
  ["mkFluid", "Parts markup · oil & fluids", "%", "Keeps oil changes near $89–99 at home", { min: 0, max: 300 }],
  ["fee", "Platform fee", "%", "Taken from partner labor only; parts are reimbursed at cost", { min: 0, max: 60 }],
  ["minPay", "Minimum partner pay per visit", "$", "Auto-Auto tops up small jobs", { min: 0, max: 500 }],
  ["protect", "Service protection fee", "$", "Charged to customers per job; funds Partner Protection", { min: 0, max: 100 }],
  ["mobile", "Mobile service fee", "$", "At-home and roadside jobs; goes to the partner", { min: 0, max: 200 }],
  ["diag", "Diagnose It visit", "$", "Credited if the repair quote is approved within 7 days", { min: 0, max: 500 }],
  ["late", "Late cancel fee", "$", "Inside the free cancel window", { min: 0, max: 500 }],
  ["enroute", "On-the-way / no-show fee", "$", "Partner already driving or waited 15 min", { min: 0, max: 500 }],
  ["cancelH", "Free cancel window", "hours", "Before the arrival window", { min: 0, max: 336, int: true }],
  ["depositOver", "Deposit required over", "$", "Job total threshold", { min: 0, max: 10000 }],
  ["depositPct", "Deposit size", "%", "Or the parts cost, whichever is higher", { min: 0, max: 100 }],
  ["window", "Request window", "hours", "Before an open request closes", { min: 1, max: 48 }],
  ["roadside", "Roadside window", "hours", "Emergency jobs", { min: 0.25, max: 12 }],
  ["warrantyMo", "Warranty length", "months", "", { min: 0, max: 60, int: true }],
  ["warrantyMi", "Warranty miles", "mi", "", { min: 0, max: 100000, int: true }],
  ["deductible", "Partner deductible", "$", "Per at-fault Partner Protection claim", { min: 0, max: 10000 }],
  ["plus", "Plus membership", "$/mo", "Waives mobile and protection fees", { min: 0, max: 100 }],
  ["dailyAfter", "Daily payouts unlock after", "jobs", "New partners are paid weekly until then", { min: 0, max: 1000, int: true }],
  ["reservePct", "New-partner reserve", "%", "Held from each payout until daily unlocks, then paid back", { min: 0, max: 50 }],
  ["recoverMax", "Max recovery per payout", "%", "Cap on deductibles and balances owed taken from one payout", { min: 0, max: 100 }],
  ["instantFee", "Instant cash-out fee", "$", "Processor costs about 1% (min $0.50)", { min: 0, max: 20 }],
  ["cardBuf", "Parts card buffer", "%", "Card limit = job parts estimate + this", { min: 0, max: 100 }],
  ["offerSecs", "Offer time per partner", "sec", "Closest qualified partner first, one at a time", { min: 5, max: 600, int: true }],
  ["offerMax", "Partners offered one at a time", "partners", "Then the request goes to everyone in range at once", { min: 0, max: 50, int: true }],
  ["widenMi", "Widen search to", "mi", "Happens automatically halfway through the request window", { min: 1, max: 200, int: true }],
  ["approveNow", "Customer approval time · same day", "min", "No answer: offer goes to the next partner", { min: 1, max: 240, int: true }],
  ["approveLater", "Customer approval time · scheduled", "min", "", { min: 1, max: 2880, int: true }],
  ["holdHrs", "Card hold before visit", "hours", "Card holds expire after about a week", { min: 0, max: 144, int: true }],
  ["pcxCredit", "Customer credit when a partner cancels late", "$", "Paid by Auto-Auto", { min: 0, max: 500 }],
  ["pcxFreeHrs", "Partner can cancel free until", "hours before", "", { min: 0, max: 336, int: true }],
  ["lateCxReview", "Late partner cancels before review", "in 30 days", "", { min: 1, max: 30, int: true }],
  ["fleetLabor", "Default fleet labor rate", "$/hr", "New fleet accounts start here; set per fleet", { min: 1, max: 500 }],
  ["fleetMk", "Fleet parts markup", "%", "Parts are bought on the partner's parts card at cost", { min: 0, max: 300 }],
  ["fleetTrip", "Fleet trip fee", "$ per visit", "Replaces the per-vehicle mobile fee; goes to the partner", { min: 0, max: 500 }],
  ["fleetWash", "Fleet wash labor rate", "$/hr", "Exterior washes and cab cleaning", { min: 1, max: 500 }],
  ["glassMk", "Glass markup", "%", "On the partner's quoted glass cost", { min: 0, max: 300 }],
  ["glassKit", "Glass install kit", "$", "Urethane, moldings, clips per replacement", { min: 0, max: 500 }],
  ["quickMk", "Quick-fix parts markup", "%", "Quick fixes are flat-rate labor plus parts", { min: 0, max: 300 }],
];

export const DEFAULTS = {
  labor: 100, shopLabor: 140, minPay: 35, mk50: 50, mk200: 35, mk500: 25, mkTop: 15, mkFluid: 30, fee: 20, protect: 3, mobile: 15,
  diag: 49, late: 25, enroute: 50, cancelH: 48, depositOver: 300, depositPct: 25, window: 4, roadside: 1, warrantyMo: 12,
  warrantyMi: 12000, deductible: 500, plus: 9.99, dailyAfter: 10, reservePct: 5, recoverMax: 25, instantFee: 0.85, cardBuf: 10,
  offerSecs: 30, offerMax: 5, widenMi: 35, approveNow: 5, approveLater: 120, holdHrs: 24, pcxCredit: 15, pcxFreeHrs: 24,
  lateCxReview: 3, fleetLabor: 85, fleetMk: 10, fleetTrip: 25, fleetWash: 60, glassMk: 15, glassKit: 28, quickMk: 15,
};

const BY_KEY = new Map(META.map((m) => [m[0], m]));

export function metaOut() {
  return META.map(([key, label, unit, hint, r]) => ({ key, label, unit, hint, min: r.min, max: r.max, wholeNumber: !!r.int }));
}

// Checks a set of changes. Returns cleaned numbers or throws with a message per field.
export function checkChanges(changes) {
  const fields = {};
  const out = {};
  if (!changes || typeof changes !== "object" || Array.isArray(changes) || !Object.keys(changes).length) {
    throw new HttpError(422, "invalid_input", "Some fields need fixing.", { fields: { changes: "Change at least one setting." } });
  }
  for (const [k, raw] of Object.entries(changes)) {
    const m = BY_KEY.get(k);
    if (!m) { fields[k] = "That isn't a setting. Refresh the page and try again."; continue; }
    const [, label, unit, , r] = m;
    const n = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : NaN;
    if (!Number.isFinite(n)) { fields[k] = `Enter a number for ${label.toLowerCase()}.`; continue; }
    if (r.int && !Number.isInteger(n)) { fields[k] = `Use a whole number of ${unit} for ${label.toLowerCase()}.`; continue; }
    if (n < r.min || n > r.max) { fields[k] = `${label} must be between ${r.min} and ${r.max} ${unit}.`; continue; }
    out[k] = Math.round(n * 100) / 100;
  }
  if (Object.keys(fields).length) throw new HttpError(422, "invalid_input", "Some fields need fixing.", { fields });
  return out;
}

export function createSettingsStore({ db, now = () => Date.now() }) {
  async function seed() {
    await db.run(
      `INSERT INTO pricing_settings (version, settings, note, created_by, created_at) VALUES (1, $1, $2, NULL, $3) ON CONFLICT (version) DO NOTHING`,
      [JSON.stringify(DEFAULTS), "Starting values from the design phase (RULES.md, Oct 2026)", now()],
    );
  }
  const row = (r) => r && { version: r.version, settings: { ...DEFAULTS, ...JSON.parse(r.settings) }, note: r.note, createdBy: r.created_by, createdAt: r.created_at };

  return {
    async current() {
      let r = await db.get(`SELECT * FROM pricing_settings ORDER BY version DESC LIMIT 1`);
      if (!r) { await seed(); r = await db.get(`SELECT * FROM pricing_settings ORDER BY version DESC LIMIT 1`); }
      return row(r);
    },
    async version(v) {
      if (v === 1) await seed();
      return row(await db.get(`SELECT * FROM pricing_settings WHERE version = $1`, [v]));
    },
    async history(limit = 50) {
      await seed();
      const rows = await db.all(`SELECT * FROM pricing_settings ORDER BY version DESC LIMIT $1`, [limit]);
      // Show what changed in each version compared with the one before it.
      return rows.map((r, i) => {
        const cur = row(r);
        const prev = rows[i + 1] ? row(rows[i + 1]) : null;
        const changes = prev ? Object.keys(cur.settings).filter((k) => cur.settings[k] !== prev.settings[k]).map((k) => ({ key: k, from: prev.settings[k], to: cur.settings[k] })) : [];
        return { version: cur.version, note: cur.note, createdBy: cur.createdBy, createdAt: cur.createdAt, changes };
      });
    },
    // Publishes a new version. expectedVersion guards against two admins publishing over each other.
    async publish({ changes, note, userId, expectedVersion }) {
      const clean = checkChanges(changes);
      const n = typeof note === "string" ? note.trim() : "";
      if (n.length < 5) throw new HttpError(422, "invalid_input", "Some fields need fixing.", { fields: { note: "Say why you're making this change. It's kept in the history." } });
      if (n.length > 300) throw new HttpError(422, "invalid_input", "Some fields need fixing.", { fields: { note: "Keep the note under 300 characters." } });
      return db.tx(async (t) => {
        const cur = row(await t.get(`SELECT * FROM pricing_settings ORDER BY version DESC LIMIT 1`)) || { version: 1, settings: { ...DEFAULTS } };
        if (expectedVersion != null && Number(expectedVersion) !== cur.version) {
          throw new HttpError(409, "version_changed", `Someone published version ${cur.version} while you were editing. Reload to see it, then make your changes again.`);
        }
        const next = { ...cur.settings, ...clean };
        if (Object.keys(clean).every((k) => cur.settings[k] === clean[k])) {
          throw new HttpError(422, "invalid_input", "Some fields need fixing.", { fields: { changes: "Those are already the live values. Change at least one number." } });
        }
        const version = cur.version + 1;
        try {
          await t.run(`INSERT INTO pricing_settings (version, settings, note, created_by, created_at) VALUES ($1, $2, $3, $4, $5)`, [version, JSON.stringify(next), n, userId, now()]);
        } catch (e) {
          if (/unique|duplicate|primary/i.test(String(e.message))) throw new HttpError(409, "version_changed", "Someone published at the same moment. Reload and try again.");
          throw e;
        }
        return { version, settings: next, note: n };
      });
    },
  };
}
