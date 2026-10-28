// Partner onboarding (prototypes/partner-app.html, "Apply"): each step's answers, uploaded documents,
// e-signatures, identity and background checks, and staff review.
// Never stored: SSN/EIN and bank numbers (Stripe collects them), driver's license numbers and ID photos
// (Stripe Identity checks them; we keep only whether it passed and whether the partner is 21 or older).
import { HttpError } from "../lib/http.js";
import { newId } from "../auth/tokens.js";
import { US_STATES } from "../lib/validate.js";
import { AGREEMENT_IDS, documentById, documentOut } from "./documents.js";

const DAY = 86_400_000;
const MAX_FILE_BYTES = 6 * 1024 * 1024;
const FILE_TYPES = { "application/pdf": "PDF", "image/jpeg": "JPG", "image/png": "PNG", "image/heic": "HEIC", "image/webp": "WEBP" };

export const DOC_KINDS = {
  gl: "General liability certificate",
  gk: "Garagekeepers certificate",
  auto: "Vehicle insurance declarations page",
  wc: "Workers' compensation certificate",
  ase: "ASE certificate or brake-work proof",
  epa609: "EPA Section 609 certificate",
  buslic: "Shop business license",
  glass_cert: "Auto glass certification",
  dot_cert: "DOT inspector qualification",
  wash: "Water containment proof",
  other: "Other document",
};

export const STEPS = [
  ["area", "Service area"],
  ["services", "Services you offer"],
  ["business", "Business & tax"],
  ["identity", "Identity & driving"],
  ["background", "Background check"],
  ["insurance", "Insurance"],
  ["skills", "Experience & certifications"],
  ["safety", "Safety standards"],
  ["payouts", "Payouts"],
  ["agreements", "Agreements"],
];

// What each step can save. Everything is optional while saving; the step's checklist says what's still missing.
const TEXT = (max) => ({ type: "text", max });
const ENUM = (...values) => ({ type: "enum", values });
const BOOL = { type: "bool" };
const DATE = { type: "date" };
const STATE = { type: "state" };
const ZIP = { type: "zip" };
const FIELDS = {
  business: {
    legalFirst: TEXT(50), legalMiddle: TEXT(50), legalLast: TEXT(50),
    entity: ENUM("individual", "smllc", "llc", "corp"), businessName: TEXT(80), dba: TEXT(80),
    street: TEXT(100), city: TEXT(60), state: STATE, zip: ZIP, employees: ENUM("0", "1-4", "5+"),
  },
  identity: { dlState: STATE, dlExpires: DATE, yearsLicensed: ENUM("1", "2", "5", "10") },
  background: { copyRequested: BOOL },
  insurance: {
    coverage: ENUM("aa", "split", "own"), ppTerms: BOOL,
    glCarrier: TEXT(80), glPolicy: TEXT(40), glExpires: DATE, glOccurrence: ENUM("500000", "1000000", "2000000"), glAggregate: ENUM("1000000", "2000000", "3000000"), glAdditionalInsured: BOOL,
    gkCarrier: TEXT(80), gkPolicy: TEXT(40), gkExpires: DATE, gkLimit: ENUM("50000", "100000", "250000"), gkAtCustomer: BOOL,
    autoType: ENUM("commercial", "bizuse"), autoCarrier: TEXT(80), autoPolicy: TEXT(40), autoExpires: DATE, autoLimit: ENUM("300000", "500000", "1000000"), autoBizUse: BOOL,
    wcExpires: DATE, wcAck: BOOL,
  },
  skills: {
    experience: ENUM("0", "2", "5", "10"), setting: ENUM("mobile", "shop", "both"),
    shopStreet: TEXT(100), shopCity: TEXT(60), shopState: STATE, shopZip: ZIP,
    brakeExperience: BOOL, epa609Number: TEXT(30), acEquipment: BOOL, lockoutId: BOOL, fuelCans: BOOL,
  },
  safety: { lift: BOOL, spill: BOOL, fire: BOOL, usedOil: BOOL, filters: BOOL, noStreet: BOOL, sober: BOOL, usedOilSite: TEXT(120) },
  payouts: { tax1099: BOOL, tips: BOOL },
};
const MIN_LIMITS = { glOccurrence: 1_000_000, glAggregate: 2_000_000, gkLimit: 100_000, autoLimit: 500_000 };
const usd = (n) => `$${Number(n).toLocaleString("en-US")}`;
const SAFETY = ["lift", "spill", "fire", "usedOil", "filters", "noStreet", "sober"];
const BRAKES = ["brakes", "dot_brake"];
const GLASS = ["glass_chip", "glass_windshield", "glass_side", "glass_back", "glass_adas"];
const DOT = ["dot_annual", "dot_brake", "dot_dvir"];
const WASH = ["exterior_wash", "full_detail", "fleet_wash"];

const bad = (field, msg) => new HttpError(422, "invalid_input", "Some fields need fixing.", { fields: { [field]: msg } });
const J = (s, d) => (s ? JSON.parse(s) : d);
const normName = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");

function clean(section, body) {
  const spec = FIELDS[section];
  const out = {};
  for (const [k, f] of Object.entries(spec)) {
    if (!(k in body)) continue;
    let v = body[k];
    if (v === null || v === "") { out[k] = null; continue; }
    if (f.type === "bool") { if (typeof v !== "boolean") throw bad(k, "Choose yes or no."); out[k] = v; continue; }
    if (typeof v !== "string") v = String(v);
    v = v.trim();
    if (f.type === "text") { if (v.length > f.max) throw bad(k, `Keep this under ${f.max} characters.`); out[k] = v || null; }
    else if (f.type === "enum") { if (!f.values.includes(v)) throw bad(k, "Pick one of the choices."); out[k] = v; }
    else if (f.type === "state") { v = v.toUpperCase(); if (!US_STATES.has(v)) throw bad(k, "Use the 2-letter state code, like TN."); out[k] = v; }
    else if (f.type === "zip") { if (!/^\d{5}$/.test(v)) throw bad(k, "ZIP must be 5 digits."); out[k] = v; }
    else if (f.type === "date") { if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(`${v}T12:00:00Z`))) throw bad(k, "Enter the date as YYYY-MM-DD."); out[k] = v; }
  }
  return out;
}

// Checks a file's first bytes match its type, so a renamed file can't sneak through.
export function looksLike(type, buf) {
  if (type === "application/pdf") return buf.subarray(0, 5).toString("latin1") === "%PDF-";
  if (type === "image/jpeg") return buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  if (type === "image/png") return buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (type === "image/webp") return buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP";
  if (type === "image/heic") return buf.subarray(4, 8).toString("latin1") === "ftyp";
  return false;
}

export function createOnboarding({ db, stripe = null, payments = null, now = () => Date.now(), log = () => {} }) {
  const daysUntil = (date) => (date ? Math.floor((Date.parse(`${date}T12:00:00Z`) - now()) / DAY) : null);

  async function appRow(userId) {
    let a = await db.get(`SELECT * FROM partner_applications WHERE user_id = $1`, [userId]);
    if (!a) {
      await db.run(`INSERT INTO partner_applications (user_id, created_at, updated_at) VALUES ($1, $2, $2) ON CONFLICT (user_id) DO NOTHING`, [userId, now()]);
      a = await db.get(`SELECT * FROM partner_applications WHERE user_id = $1`, [userId]);
    }
    return a;
  }

  const currentDocs = async (userId) => db.all(
    `SELECT id, kind, filename, content_type, size_bytes, status, review_note, created_at FROM partner_documents WHERE user_id = $1 AND replaced_at IS NULL ORDER BY created_at`, [userId]);

  // Latest valid signature per document (signing an older version doesn't count once the text changes).
  async function currentSigs(userId) {
    const rows = await db.all(`SELECT * FROM partner_signatures WHERE user_id = $1 AND revoked_at IS NULL ORDER BY signed_at`, [userId]);
    const out = {};
    for (const r of rows) {
      const d = documentById(r.doc_id);
      if (d && d.version === r.doc_version && d.hash === r.doc_hash) out[r.doc_id] = r;
    }
    return out;
  }

  async function context(userId) {
    const [a, docs, sigs, profile, area, svc, acct] = await Promise.all([
      appRow(userId), currentDocs(userId), currentSigs(userId),
      db.get(`SELECT status, status_reason FROM partner_profiles WHERE user_id = $1`, [userId]),
      db.get(`SELECT user_id FROM partner_service_areas WHERE user_id = $1`, [userId]),
      db.all(`SELECT service_id FROM partner_services WHERE user_id = $1`, [userId]),
      db.get(`SELECT * FROM payout_accounts WHERE user_id = $1`, [userId]),
    ]);
    return { a, ans: J(a.answers, {}), docs, docBy: Object.fromEntries(docs.map((d) => [d.kind, d])), sigs, profile, area, services: new Set(svc.map((r) => r.service_id)), acct };
  }

  // What's still missing for each step, in plain English.
  function errorsFor(step, c) {
    const e = [];
    const a = c.ans[step] || {};
    const need = (v, msg) => { if (v == null || v === "" || v === false) e.push(msg); };
    const doc = (kind) => {
      const d = c.docBy[kind];
      if (!d) e.push(`Upload your ${DOC_KINDS[kind].toLowerCase()}`);
      else if (d.status === "rejected") e.push(`${DOC_KINDS[kind]} wasn't accepted${d.review_note ? `: ${d.review_note}` : ""}. Upload a new one`);
    };
    const expiry = (date, label) => {
      const d = daysUntil(date);
      if (d == null) e.push(`${label}: add the expiration date`);
      else if (d < 30) e.push(`${label}: expires in under 30 days. Renew it first`);
    };
    switch (step) {
      case "area": if (!c.area) e.push("Set your home base and travel radius"); break;
      case "services": if (!c.services.size) e.push("Turn on at least one service"); break;
      case "business": {
        need(c.a.legal_first, "Add your legal first name");
        need(c.a.legal_last, "Add your legal last name");
        need(a.entity, "Choose how you'll get paid");
        if (a.entity && a.entity !== "individual") need(a.businessName, "Add the business legal name");
        need(a.street, "Add your address");
        need(a.city, "Add your city");
        need(a.state, "Add your state");
        need(a.zip, "Add your ZIP");
        need(a.employees, "Tell us how many people work for you");
        if (!c.sigs.esign) e.push("Agree to sign documents electronically");
        if (!c.sigs.w9) e.push("Sign the W-9 certification");
        break;
      }
      case "identity": {
        need(a.dlState, "Add the state that issued your license");
        const d = daysUntil(a.dlExpires);
        if (d == null) e.push("Add your license expiration date");
        else if (d < 1) e.push("Your license has expired");
        else if (d < 30) e.push("Your license expires within 30 days. Renew it first");
        if (!a.yearsLicensed) e.push("Tell us how long you've had your license");
        else if (a.yearsLicensed === "1") e.push("You need a driver's license held for 2 years or more");
        if (c.a.identity_status !== "verified") e.push(c.a.identity_status === "processing" ? "Your ID check is still processing" : "Verify your ID and selfie");
        else if (c.a.identity_over_21 === 0) e.push("You must be 21 or older to be a partner");
        break;
      }
      case "background":
        if (!c.sigs.bg_disclosure) e.push("Read the background check disclosure");
        if (!c.sigs.bg_auth) e.push("Sign the background check authorization");
        break;
      case "insurance": {
        const cov = a.coverage;
        if (!cov) { e.push("Choose how you're covered"); break; }
        if (cov !== "own" && !a.ppTerms) e.push("Confirm the Partner Protection terms");
        const policy = (p, label) => {
          need(a[`${p}Carrier`], `${label}: add the insurance company`);
          need(a[`${p}Policy`], `${label}: add the policy number`);
          expiry(a[`${p}Expires`], label);
          doc(p);
        };
        const limit = (k, label) => { if (!a[k]) e.push(`${label}: choose the limit`); else if (Number(a[k]) < MIN_LIMITS[k]) e.push(`${label}: needs at least ${usd(MIN_LIMITS[k])}`); };
        if (cov !== "aa") {
          policy("gl", "General liability");
          limit("glOccurrence", "General liability per occurrence");
          limit("glAggregate", "General liability aggregate");
          if (!a.glAdditionalInsured) e.push("Name Auto-Auto, Inc. as an additional insured on your general liability");
        }
        if (cov === "own") {
          policy("gk", "Garagekeepers");
          limit("gkLimit", "Garagekeepers");
          if (!a.gkAtCustomer) e.push("Confirm your garagekeepers covers customer locations");
          if (!c.sigs.optout) e.push("Sign the Own Insurance Election & Indemnity");
        }
        if (!a.autoType) e.push("Vehicle insurance: choose the policy type");
        else {
          policy("auto", "Vehicle insurance");
          if (a.autoType === "commercial") limit("autoLimit", "Commercial auto");
          else if (!a.autoBizUse) e.push("Vehicle insurance: confirm business use is covered");
        }
        const employees = (c.ans.business || {}).employees;
        if (employees === "5+") { expiry(a.wcExpires, "Workers' compensation"); doc("wc"); }
        else if (!a.wcAck) e.push("Confirm the workers' compensation rule");
        break;
      }
      case "skills": {
        if (!a.experience) e.push("Tell us your hands-on experience");
        else if (a.experience === "0" && !c.docBy.ase) e.push("You need 2+ years of experience or an ASE certificate");
        if (!a.setting) e.push("Tell us where you work");
        else if (a.setting !== "mobile") {
          need(a.shopStreet, "Add your shop's street address");
          need(a.shopCity, "Add your shop's city");
          need(a.shopZip, "Add your shop's ZIP");
          doc("buslic");
        }
        const offers = (ids) => ids.some((x) => c.services.has(x));
        if (offers(BRAKES)) doc("ase");
        else if (c.services.has("diagnostics") && !c.docBy.ase && !a.brakeExperience) e.push("Diagnostics: upload an ASE certificate or confirm 2+ years of paid diagnostic work");
        if (c.services.has("ac_service")) { need(a.epa609Number, "A/C service: add your Section 609 certificate number"); doc("epa609"); if (!a.acEquipment) e.push("A/C service: confirm you use approved recovery equipment"); }
        if (offers(GLASS)) doc("glass_cert");
        if (offers(DOT)) doc("dot_cert");
        if (offers(WASH)) doc("wash");
        if (c.services.has("lockout") && !a.lockoutId) e.push("Lockouts: confirm you'll check ID and proof of ownership");
        if (c.services.has("fuel_delivery") && !a.fuelCans) e.push("Fuel delivery: confirm you use approved containers");
        break;
      }
      case "safety":
        if (SAFETY.some((k) => !a[k])) e.push("Confirm every safety standard");
        need(a.usedOilSite, "Tell us where you take used oil");
        break;
      case "payouts":
        if (payments && payments.enabled && !(c.acct && c.acct.details_submitted)) e.push("Set up payouts with Stripe");
        if (!a.tax1099) e.push("Confirm the tax statement");
        if (!a.tips) e.push("Confirm the tips statement");
        break;
      case "agreements":
        for (const id of AGREEMENT_IDS) if (!c.sigs[id]) e.push(`Sign: ${documentById(id).title}`);
        break;
    }
    return [...new Set(e)];
  }

  function stateOut(c, { forStaff = false } = {}) {
    const steps = STEPS.map(([id, title]) => { const errors = errorsFor(id, c); return { id, title, done: !errors.length, errors }; });
    const status = c.profile ? c.profile.status : "applicant";
    return {
      status, statusReason: c.profile && c.profile.status_reason,
      locked: status === "in_review",
      submittedAt: c.a.submitted_at, decision: c.a.decision, decisionNote: c.a.decision_note,
      legalName: { first: c.a.legal_first, middle: c.a.legal_middle, last: c.a.legal_last },
      answers: c.ans,
      servicesOffered: [...c.services],
      steps, ready: steps.every((s) => s.done),
      documents: c.docs.map((d) => ({ id: d.id, kind: d.kind, label: DOC_KINDS[d.kind], filename: d.filename, contentType: d.content_type, sizeBytes: d.size_bytes, status: d.status, reviewNote: d.review_note, uploadedAt: d.created_at })),
      signatures: Object.fromEntries(Object.entries(c.sigs).map(([k, s]) => [k, { name: s.signed_name, version: s.doc_version, signedAt: s.signed_at, ...(forStaff ? { ip: s.ip, userAgent: s.user_agent, hash: s.doc_hash } : {}) }])),
      agreements: AGREEMENT_IDS.map((id) => ({ id, title: documentById(id).title, signed: !!c.sigs[id] })),
      identity: { enabled: !!stripe, status: c.a.identity_status, over21: c.a.identity_over_21 == null ? null : !!c.a.identity_over_21, checkedAt: c.a.identity_checked_at },
      background: { status: c.a.background_status, ...(forStaff ? { note: c.a.background_note } : {}) },
      payouts: { enabled: !!(payments && payments.enabled), detailsSubmitted: !!(c.acct && c.acct.details_submitted) },
      arbitration: { optedOutAt: c.a.arbitration_opt_out_at, canOptOutUntil: c.sigs.arb && !c.a.arbitration_opt_out_at ? c.sigs.arb.signed_at + 30 * DAY : null },
    };
  }

  const state = async (userId, opts) => stateOut(await context(userId), opts);

  async function editable(userId) {
    const p = await db.get(`SELECT status FROM partner_profiles WHERE user_id = $1`, [userId]);
    if (!p) throw new HttpError(403, "not_partner", "Only partners have an application.");
    if (p.status === "in_review") throw new HttpError(409, "in_review", "We're reviewing your application. If anything needs changing, we'll send it back to you.");
    if (p.status === "deactivated") throw new HttpError(403, "deactivated", "This account can't make changes. Contact partner support.");
  }

  async function touch(userId) { await db.run(`UPDATE partner_applications SET updated_at = $1 WHERE user_id = $2`, [now(), userId]); }

  const api = {
    STEPS,
    state,

    async save(user, section, body) {
      if (!FIELDS[section]) throw new HttpError(404, "not_found", "That step doesn't exist.");
      await editable(user.id);
      const a = await appRow(user.id);
      const v = clean(section, body || {});
      if (section === "business") {
        const names = { legalFirst: "legal_first", legalMiddle: "legal_middle", legalLast: "legal_last" };
        for (const [k, col] of Object.entries(names)) {
          if (k in v) await db.run(`UPDATE partner_applications SET ${col} = $1 WHERE user_id = $2`, [v[k], user.id]);
          delete v[k];
        }
      }
      const ans = J(a.answers, {});
      ans[section] = { ...(ans[section] || {}), ...v };
      await db.run(`UPDATE partner_applications SET answers = $1, updated_at = $2 WHERE user_id = $3`, [JSON.stringify(ans), now(), user.id]);
      return state(user.id);
    },

    document(id) {
      const d = documentById(id);
      if (!d) throw new HttpError(404, "not_found", "That document doesn't exist.");
      return documentOut(d);
    },

    // Typed-name e-signature. Consent and disclosure acknowledgements don't need a typed name.
    async sign(user, docId, typedName, { ip, userAgent }) {
      const d = documentById(docId);
      if (!d) throw new HttpError(404, "not_found", "That document doesn't exist.");
      await editable(user.id);
      const c = await context(user.id);
      if (c.sigs[docId]) return stateOut(c);
      let name = null;
      if (d.kind === "signature" || d.kind === "agreement") {
        if (!c.sigs.esign) throw new HttpError(409, "esign_required", "Agree to sign documents electronically first (Business & tax).");
        const legal = [c.a.legal_first, c.a.legal_middle, c.a.legal_last].filter(Boolean).join(" ");
        if (!c.a.legal_first || !c.a.legal_last) throw new HttpError(409, "legal_name_required", "Add your legal name in Business & tax before signing.");
        if (normName(typedName) !== normName(legal)) throw bad("name", `Type your full legal name exactly: ${legal}`);
        name = String(typedName).trim().replace(/\s+/g, " ");
      }
      if (docId === "bg_auth" && !c.sigs.bg_disclosure) throw new HttpError(409, "disclosure_required", "Read the background check disclosure first.");
      await db.run(
        `INSERT INTO partner_signatures (id, user_id, doc_id, doc_version, doc_hash, signed_name, ip, user_agent, signed_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [newId(), user.id, d.id, d.version, d.hash, name, ip || null, (userAgent || "").slice(0, 300) || null, now()],
      );
      // The background check starts once it's authorized. (The check itself runs through a vendor that isn't chosen yet; staff record the result.)
      if (docId === "bg_auth") await db.run(`UPDATE partner_applications SET background_status = 'pending', background_updated_at = $1 WHERE user_id = $2 AND background_status = 'not_started'`, [now(), user.id]);
      await touch(user.id);
      return state(user.id);
    },

    async optOutOfArbitration(user) {
      const c = await context(user.id);
      if (!c.sigs.arb) throw new HttpError(409, "not_signed", "You haven't signed the arbitration agreement.");
      if (c.a.arbitration_opt_out_at) return stateOut(c);
      if (now() > c.sigs.arb.signed_at + 30 * DAY) throw new HttpError(409, "too_late", "The 30-day window to opt out of arbitration has passed.");
      await db.run(`UPDATE partner_applications SET arbitration_opt_out_at = $1, updated_at = $1 WHERE user_id = $2`, [now(), user.id]);
      return state(user.id);
    },

    async upload(user, b) {
      await editable(user.id);
      const kind = String(b.kind || "");
      if (!DOC_KINDS[kind]) throw bad("kind", "Pick what this document is.");
      const type = String(b.contentType || "").toLowerCase();
      if (!FILE_TYPES[type]) throw bad("file", "Upload a PDF or a photo (JPG, PNG, or HEIC).");
      if (typeof b.data !== "string" || !b.data) throw bad("file", "Choose a file to upload.");
      const buf = Buffer.from(b.data.replace(/^data:[^,]*,/, ""), "base64");
      if (!buf.length) throw bad("file", "That file is empty.");
      if (buf.length > MAX_FILE_BYTES) throw bad("file", "That file is over 6 MB. Take a photo instead, or upload a smaller PDF.");
      if (!looksLike(type, buf)) throw bad("file", "That file doesn't look like a PDF or photo. Try again.");
      const filename = (String(b.filename || `${kind}.${FILE_TYPES[type].toLowerCase()}`).replace(/[^\w.\- ()]/g, "_").slice(0, 80)) || "document";
      const at = now();
      await db.tx(async (t) => {
        await t.run(`UPDATE partner_documents SET replaced_at = $1 WHERE user_id = $2 AND kind = $3 AND replaced_at IS NULL`, [at, user.id, kind]);
        await t.run(
          `INSERT INTO partner_documents (id, user_id, kind, filename, content_type, size_bytes, data, status, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8)`,
          [newId(), user.id, kind, filename, type, buf.length, buf.toString("base64"), at],
        );
      });
      await touch(user.id);
      return state(user.id);
    },

    async removeUpload(user, id) {
      await editable(user.id);
      const r = await db.run(`UPDATE partner_documents SET replaced_at = $1 WHERE id = $2 AND user_id = $3 AND replaced_at IS NULL`, [now(), String(id), user.id]);
      if (!r.changes) throw new HttpError(404, "not_found", "That document isn't on your account.");
      return state(user.id);
    },

    async file(id, { userId, staff }) {
      const d = await db.get(`SELECT * FROM partner_documents WHERE id = $1`, [String(id)]);
      if (!d || (!staff && d.user_id !== userId)) throw new HttpError(404, "not_found", "That document doesn't exist.");
      return { contentType: d.content_type, filename: d.filename, bytes: Buffer.from(d.data, "base64") };
    },

    // ---------- Identity (Stripe Identity: license photo + matching selfie) ----------
    async startIdentity(user, { returnTo, apiBase }) {
      await editable(user.id);
      if (!stripe) throw new HttpError(503, "identity_off", "ID checks aren't turned on yet. Partner support can verify you instead.");
      const a = await appRow(user.id);
      if (a.identity_status === "verified") return state(user.id);
      const back = `${apiBase}/pay/return?to=${encodeURIComponent(returnTo || "")}&ok=1`;
      let s;
      try {
        s = await stripe.createIdentitySession({
          type: "document", return_url: back, metadata: { user_id: user.id },
          options: { document: { allowed_types: ["driving_license"], require_matching_selfie: true, require_live_capture: true } },
        });
      } catch (e) {
        log(`[identity] couldn't start: ${e.code || ""} ${e.message}`);
        // Most often: Stripe Identity hasn't been turned on in the Stripe dashboard yet.
        throw new HttpError(502, "identity_unavailable", "We couldn't start the ID check right now. Try again in a few minutes, or contact partner support.");
      }
      await db.run(`UPDATE partner_applications SET identity_session_id = $1, identity_status = 'requires_input', updated_at = $2 WHERE user_id = $3`, [s.id, now(), user.id]);
      return { url: s.url };
    },

    async syncIdentity(user) {
      const a = await appRow(user.id);
      if (!stripe || !a.identity_session_id || a.identity_status === "verified") return state(user.id);
      const s = await stripe.getIdentitySession(a.identity_session_id);
      const map = { requires_input: "requires_input", processing: "processing", verified: "verified", canceled: "canceled" };
      const st = map[s.status] || "failed";
      let over21 = null;
      const dob = s.verified_outputs && s.verified_outputs.dob;
      if (st === "verified" && dob && dob.year) {
        const today = new Date(now());
        let age = today.getUTCFullYear() - dob.year;
        if (today.getUTCMonth() + 1 < dob.month || (today.getUTCMonth() + 1 === dob.month && today.getUTCDate() < dob.day)) age--;
        over21 = age >= 21 ? 1 : 0;
      }
      // Only the result is kept: not the date of birth, license number, or photos.
      await db.run(`UPDATE partner_applications SET identity_status = $1, identity_over_21 = $2, identity_checked_at = $3, updated_at = $3 WHERE user_id = $4`, [st, over21, now(), user.id]);
      const out = await state(user.id);
      if (st === "requires_input" && s.last_error) out.identity.problem = s.last_error.reason || "Stripe couldn't verify your ID. Try again with a clear photo in good light.";
      return out;
    },

    // ---------- Submit ----------
    async submit(user, b) {
      await editable(user.id);
      const c = await context(user.id);
      const s = stateOut(c);
      if (s.status !== "applicant") throw new HttpError(409, "already_submitted", "Your application was already submitted.");
      const missing = s.steps.filter((x) => !x.done);
      if (missing.length) throw new HttpError(422, "incomplete", `Finish these first: ${missing.map((x) => x.title).join(", ")}.`, { steps: missing.map((x) => x.id) });
      if (b.certify !== true) throw bad("certify", "Confirm everything in your application is true and complete.");
      await db.tx(async (t) => {
        await t.run(`UPDATE partner_applications SET submitted_at = $1, decision = NULL, decision_note = NULL, updated_at = $1 WHERE user_id = $2`, [now(), user.id]);
        await t.run(`UPDATE partner_profiles SET status = 'in_review', status_reason = NULL, updated_at = $1 WHERE user_id = $2`, [now(), user.id]);
      });
      return state(user.id);
    },

    // Active partners can't take jobs while required insurance has expired (Liability agreement: "Jobs pause automatically if required coverage lapses").
    async coverageProblem(userId) {
      const a = await db.get(`SELECT answers FROM partner_applications WHERE user_id = $1`, [userId]);
      const ans = J(a && a.answers, {});
      const ins = ans.insurance;
      if (!ins || !ins.coverage) return null;
      const check = [["autoExpires", "vehicle insurance"]];
      if (ins.coverage !== "aa") check.push(["glExpires", "general liability"]);
      if (ins.coverage === "own") check.push(["gkExpires", "garagekeepers"]);
      if ((ans.business || {}).employees === "5+") check.push(["wcExpires", "workers' compensation"]);
      for (const [k, label] of check) {
        const d = daysUntil(ins[k]);
        if (d != null && d < 0) return `Your ${label} expired on ${ins[k]}. Upload your renewed certificate in Insurance to take jobs again.`;
      }
      return null;
    },

    // ---------- Staff review ----------
    async list() {
      const rows = await db.all(
        `SELECT u.id, u.email, u.first_name, u.last_name, p.status, a.submitted_at, a.background_status, a.identity_status
         FROM users u JOIN partner_profiles p ON p.user_id = u.id LEFT JOIN partner_applications a ON a.user_id = u.id
         ORDER BY CASE p.status WHEN 'in_review' THEN 0 WHEN 'applicant' THEN 1 ELSE 2 END, a.submitted_at, u.created_at DESC LIMIT 500`,
      );
      return rows.map((r) => ({ id: r.id, email: r.email, name: `${r.first_name} ${r.last_name}`, status: r.status, submittedAt: r.submitted_at, background: r.background_status || "not_started", identity: r.identity_status || "not_started" }));
    },
    staffView: async (userId) => {
      const u = await db.get(`SELECT id, email, first_name, last_name, phone FROM users WHERE id = $1 AND role = 'partner'`, [String(userId)]);
      if (!u) throw new HttpError(404, "not_found", "No partner with that ID.");
      return { partner: { id: u.id, email: u.email, name: `${u.first_name} ${u.last_name}`, phone: u.phone }, ...(await state(u.id, { forStaff: true })) };
    },
    async reviewDocument(staff, id, b) {
      if (!["approved", "rejected"].includes(b.status)) throw bad("status", "Choose approved or rejected.");
      const note = typeof b.note === "string" ? b.note.trim().slice(0, 300) : "";
      if (b.status === "rejected" && note.length < 5) throw bad("note", "Say what's wrong. The partner sees this.");
      const r = await db.run(`UPDATE partner_documents SET status = $1, review_note = $2, reviewed_by = $3 WHERE id = $4 AND replaced_at IS NULL`, [b.status, note || null, staff.id, String(id)]);
      if (!r.changes) throw new HttpError(404, "not_found", "No current document with that ID.");
      return { ok: true };
    },
    async setBackground(staff, userId, b) {
      if (!["pending", "clear", "consider", "adverse"].includes(b.status)) throw bad("status", "Choose pending, clear, consider, or adverse.");
      await appRow(String(userId));
      await db.run(`UPDATE partner_applications SET background_status = $1, background_note = $2, background_updated_at = $3 WHERE user_id = $4`,
        [b.status, typeof b.note === "string" ? b.note.trim().slice(0, 500) || null : null, now(), String(userId)]);
      return api.staffView(userId);
    },
    // For when Stripe Identity isn't available: staff checked the ID another way.
    async setIdentity(staff, userId, b) {
      if (!["verified", "failed"].includes(b.status)) throw bad("status", "Choose verified or failed.");
      if (b.status === "verified" && typeof b.over21 !== "boolean") throw bad("over21", "Say whether they're 21 or older.");
      await appRow(String(userId));
      await db.run(`UPDATE partner_applications SET identity_status = $1, identity_over_21 = $2, identity_checked_at = $3 WHERE user_id = $4`,
        [b.status, b.status === "verified" ? (b.over21 ? 1 : 0) : null, now(), String(userId)]);
      return api.staffView(userId);
    },
    async decide(staff, userId, b) {
      const id = String(userId);
      const c = await context(id);
      if (!c.profile) throw new HttpError(404, "not_found", "No partner with that ID.");
      const note = typeof b.note === "string" ? b.note.trim().slice(0, 500) : "";
      const s = stateOut(c);
      if (b.decision === "approve") {
        if (s.status !== "in_review") throw new HttpError(409, "not_in_review", "Only submitted applications can be approved.");
        const blockers = [];
        for (const st of s.steps) if (!st.done) blockers.push(`${st.title}: ${st.errors[0]}`);
        if (c.a.background_status !== "clear") blockers.push("Background check isn't clear yet");
        if (c.a.identity_status !== "verified" || !c.a.identity_over_21) blockers.push("ID isn't verified as 21 or older");
        const unreviewed = c.docs.filter((d) => d.status !== "approved");
        if (unreviewed.length) blockers.push(`Review these documents first: ${unreviewed.map((d) => DOC_KINDS[d.kind]).join(", ")}`);
        if (blockers.length) throw new HttpError(409, "not_ready", blockers.join(". "), { blockers });
      } else if (b.decision === "return" || b.decision === "deny") {
        if (note.length < 5) throw bad("note", "Say why. The partner sees this.");
      } else throw bad("decision", "Choose approve, return, or deny.");
      const next = { approve: "active", return: "applicant", deny: "deactivated" }[b.decision];
      await db.tx(async (t) => {
        await t.run(`UPDATE partner_applications SET decision = $1, decision_note = $2, decided_at = $3, decided_by = $4, submitted_at = CASE WHEN $1 = 'return' THEN NULL ELSE submitted_at END, updated_at = $3 WHERE user_id = $5`,
          [b.decision, note || null, now(), staff.id, id]);
        await t.run(`UPDATE partner_profiles SET status = $1, status_reason = $2, updated_at = $3 WHERE user_id = $4`, [next, b.decision === "approve" ? null : note, now(), id]);
      });
      log(`[onboarding] ${b.decision} ${id} by ${staff.id}`);
      return api.staffView(id);
    },
  };
  return api;
}
