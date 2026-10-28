// After the job (step 13): ratings and reviews, tips, damage claims, warranty charge-backs, and money partners owe.
// RULES.md: 100% of tips go to the partner; an open claim holds only that job's pay; deductibles and charge-backs
// are recovered from payouts, at most 25% of any one payout.
import { HttpError } from "../lib/http.js";
import { newId } from "../auth/tokens.js";
import { serviceById } from "../catalog/services.js";
import { maskContacts } from "../maps/geo.js";
import { ratingSummary, shortName, RATING_WINDOW } from "./summary.js";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
export const RATE_DAYS = 14;
export const TIP_HOURS = 24;
export const CLAIM_DAYS = 30;
export const RESPONSE_HOURS = 48;
const PARTNER_RATE_DAYS = 7;
const REVIEW_BELOW = 4.6;
const REVIEW_MIN_RATINGS = 10;
export const POS_TAGS = ["On time", "Professional", "Clean work", "Fair price", "Great communication", "Explained the work"];
export const NEG_TAGS = ["Arrived late", "Left a mess", "Work not finished", "Price changed", "Hard to reach", "Rude"];
export const DAMAGE_TO = { vehicle: "My vehicle", property: "My property (driveway, garage)", other: "Something else" };
export const WANTS = { repair: "Repair", reimbursement: "Reimbursement", not_sure: "Not sure" };
export const COVERAGE = { protection: "Partner Protection", split: "Partner's liability + Auto-Auto garagekeepers", own: "Partner's own insurance" };
export const PAID_BY = {
  protection: "Partner Protection (partner pays the deductible from payouts, max 25% of each)",
  own_insurer: "Partner's own insurer (Auto-Auto files on their policy)",
  auto_auto: "Auto-Auto pays now, recovers from partner payouts",
};
const OUTCOME = { pay: "Approved", goodwill: "Goodwill credit", deny: "Denied" };

const bad = (field, msg) => new HttpError(422, "invalid_input", "Some fields need fixing.", { fields: { [field]: msg } });
const conflict = (msg) => new HttpError(409, "wrong_step", msg);
const notFound = (what = "That job") => new HttpError(404, "not_found", `${what} isn't on your account. Pull to refresh and try again.`);
const J = (s, d = null) => (s ? JSON.parse(s) : d);
const fmtMoney = (c) => `$${(c / 100).toFixed(2).replace(/\.00$/, "")}`;
const fmtDate = (ms) => new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });
const claimNo = (n) => `CLM-${n}`;

function parseMoney(v, field, { max = 100_000 } = {}) {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[$,\s]/g, ""));
  if (!Number.isFinite(n) || n < 0 || n > max) throw bad(field, "Enter an amount in dollars, like 180 or 420.50.");
  return Math.round(n * 100);
}
const text = (v, field, { min = 0, max = 1000, msg } = {}) => {
  const s = typeof v === "string" ? v.trim() : "";
  if (s.length < min) throw bad(field, msg || `Write at least ${min} characters.`);
  return s.slice(0, max) || null;
};

export function createCare({ db, settings, payments = null, photos = null, notify = null, now = () => Date.now(), log = () => {} }) {
  const tell = (q, uid, m) => (notify ? notify.send(q, uid, m) : null);
  const currentSettings = async () => (await settings.current()).settings;
  const servicesOf = (job) => (J(job.final, {}).lines || J(job.quote, {}).lines || []).map((l) => l.name || (serviceById(l.serviceId) || {}).name);

  async function customerJob(user, id) {
    const job = await db.get(`SELECT * FROM jobs WHERE id = $1`, [String(id)]);
    if (!job || job.customer_id !== user.id) throw notFound();
    return job;
  }
  async function partnerJob(user, id) {
    const job = await db.get(`SELECT * FROM jobs WHERE id = $1`, [String(id)]);
    if (!job || job.partner_id !== user.id) throw notFound();
    return job;
  }
  const userRow = (id) => db.get(`SELECT id, first_name, last_name, email, phone FROM users WHERE id = $1`, [id]);

  // ---------- Tips ----------
  function tipMax(job) {
    const total = J(job.final, {}).totalCents || 0;
    return Math.min(50_000, Math.max(10_000, total));
  }
  async function tipsOn(jobId) {
    return db.all(`SELECT * FROM tips WHERE job_id = $1 ORDER BY created_at`, [jobId]);
  }
  // Charges the tip (outside any transaction) and gives all of it to the partner.
  async function chargeTip(job, cents) {
    const paid = (await tipsOn(job.id)).filter((x) => x.status !== "failed");
    if (paid.length) throw conflict("You already added a tip for this visit. Thank you!");
    const id = newId();
    let status = "recorded";
    let stripeId = null;
    let error = null;
    if (payments && payments.enabled) {
      const n = (await tipsOn(job.id)).length;
      const r = await payments.chargeInvoice(job.customer_id, cents, { key: `${job.id}:tip:${n}`, description: "Tip for your Auto-Auto partner", metadata: { job_id: job.id, kind: "tip" } });
      status = r.ok ? "succeeded" : "failed";
      stripeId = r.stripeId || null;
      error = r.ok ? null : r.message;
    }
    await db.run(`INSERT INTO tips (id, job_id, customer_id, partner_id, amount_cents, status, stripe_id, error, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [id, job.id, job.customer_id, job.partner_id, cents, status, stripeId, error, now()]);
    if (status !== "failed" && payments) await payments.creditJob(job.partner_id, job.id, "earnings", cents, "Tip (100% yours)");
    return { status, amountCents: cents, message: error };
  }

  // A partner whose average drops below 4.60 (with enough ratings) gets an account review, like late cancels.
  async function checkPartnerStanding(partnerId) {
    const sum = await ratingSummary(db, partnerId);
    if (sum.count >= REVIEW_MIN_RATINGS && sum.average < REVIEW_BELOW) {
      await db.run(`UPDATE partner_profiles SET review_reason = $1, updated_at = $2 WHERE user_id = $3 AND review_reason IS NULL`, [`Rating ${sum.average.toFixed(2)} (below ${REVIEW_BELOW.toFixed(2)})`, now(), partnerId]);
    }
  }

  // ---------- Money partners owe ----------
  async function addDebt(q, { partnerId, reason, claimId = null, jobId = null, cents }) {
    if (!cents || cents <= 0) return null;
    const id = newId();
    await q.run(`INSERT INTO partner_debts (id, partner_id, reason, claim_id, job_id, cents, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)`, [id, partnerId, reason, claimId, jobId, cents, now()]);
    return id;
  }
  const debtOut = (d) => ({ id: d.id, reason: d.reason, cents: d.cents, recoveredCents: d.recovered_cents, owedCents: d.waived_at ? 0 : d.cents - d.recovered_cents, waived: !!d.waived_at, claimId: d.claim_id, jobId: d.job_id, at: d.created_at });

  // ---------- Claims ----------
  async function coverageOf(partnerId) {
    const a = await db.get(`SELECT answers FROM partner_applications WHERE user_id = $1`, [partnerId]);
    const c = ((J(a && a.answers, {}) || {}).insurance || {}).coverage;
    return c === "aa" ? "protection" : c === "split" ? "split" : c === "own" ? "own" : "protection";
  }
  async function nextClaimNumber() {
    const r = await db.get(`SELECT MAX(number) AS n FROM claims`);
    return Math.max(1040, Number(r.n || 0)) + 1;
  }
  const STEP = { partner: 1, review: 2, closed: 4 };
  async function claimOut(c, { forRole }) {
    const job = await db.get(`SELECT * FROM jobs WHERE id = $1`, [c.job_id]);
    const [cust, part] = await Promise.all([userRow(c.customer_id), userRow(c.partner_id)]);
    const base = {
      id: c.id, number: claimNo(c.number), jobId: c.job_id, status: c.status, step: STEP[c.status],
      job: { completedAt: job.completed_at, services: servicesOf(job) },
      damageTo: c.damage_to, damageToLabel: DAMAGE_TO[c.damage_to], description: c.description, wants: c.wants, wantsLabel: WANTS[c.wants], estimateCents: c.estimate_cents,
      responseDueAt: c.response_due_at, partnerResponded: !!c.responded_at,
      photos: photos ? await photos.attached(db, "claim", c.id) : [],
      decision: c.status === "closed" ? { outcome: c.outcome, outcomeLabel: OUTCOME[c.outcome], amountCents: c.amount_cents, note: c.decision_note, at: c.decided_at } : null,
      createdAt: c.created_at,
    };
    if (forRole === "customer") return { ...base, partner: shortName(part) };
    const extra = { customer: shortName(cust), partnerResponse: c.partner_response, respondedAt: c.responded_at, coverage: c.coverage, coverageLabel: COVERAGE[c.coverage] };
    if (forRole === "partner") return { ...base, ...extra, jobPhotos: photos ? await photos.forJob(db, c.job_id) : null };
    // Staff see everything, including contact details and the full job record.
    const debt = await db.all(`SELECT * FROM partner_debts WHERE claim_id = $1`, [c.id]);
    return {
      ...base, ...extra, partner: `${part.first_name} ${part.last_name}`, partnerId: c.partner_id, customerName: `${cust.first_name} ${cust.last_name}`, customerId: c.customer_id,
      customerContact: { email: cust.email, phone: cust.phone }, partnerContact: { email: part.email, phone: part.phone },
      paidBy: c.paid_by, paidByLabel: PAID_BY[c.paid_by] || null, jobPhotos: photos ? await photos.forJob(db, c.job_id) : null,
      workNotes: job.work_notes, odometer: job.odometer_in, paidByOptions: c.coverage === "protection" ? ["protection"] : ["own_insurer", "auto_auto"],
      debts: debt.map(debtOut),
    };
  }

  const api = {
    POS_TAGS, NEG_TAGS,

    // ---------- Customer: rate, review, and tip ----------
    async rate(user, jobId, b) {
      const job = await customerJob(user, jobId);
      if (job.status !== "completed") throw conflict("You can rate a visit once it's done.");
      if (now() - job.completed_at > RATE_DAYS * DAY) throw conflict(`Ratings close ${RATE_DAYS} days after the visit.`);
      if (await db.get(`SELECT id FROM ratings WHERE job_id = $1`, [job.id])) throw conflict("You already rated this visit. Thank you!");
      const stars = Number(b.stars);
      if (!Number.isInteger(stars) || stars < 1 || stars > 5) throw bad("stars", "Tap a star to rate your partner.");
      const tags = Array.isArray(b.tags) ? [...new Set(b.tags.map(String))] : [];
      if (tags.some((x) => !POS_TAGS.includes(x) && !NEG_TAGS.includes(x))) throw bad("tags", "Pick from the listed choices.");
      const ids = new Set((J(job.final, {}).lines || []).map((l) => l.serviceId));
      let serviceStars = null;
      if (b.serviceStars && typeof b.serviceStars === "object") {
        serviceStars = {};
        for (const [k, v] of Object.entries(b.serviceStars)) {
          if (!ids.has(k)) continue;
          const n = Number(v);
          if (!Number.isInteger(n) || n < 1 || n > 5) throw bad("serviceStars", "Rate each service from 1 to 5 stars.");
          serviceStars[k] = n;
        }
      }
      const review = b.review ? maskContacts(text(b.review, "review", { max: 1000 })) : null;
      const privateNote = b.privateNote ? text(b.privateNote, "privateNote", { max: 1000 }) : null;
      const tipCents = b.tipCents == null ? 0 : Number(b.tipCents);
      if (!Number.isInteger(tipCents) || tipCents < 0) throw bad("tipCents", "Choose a tip amount.");
      if (tipCents > 0 && now() - job.completed_at > TIP_HOURS * HOUR) throw bad("tipCents", `Tips close ${TIP_HOURS} hours after the visit.`);
      if (tipCents > tipMax(job)) throw bad("tipCents", `Tips can be up to ${fmtMoney(tipMax(job))}.`);
      const favorite = b.favorite === true;

      await db.tx(async (t) => {
        await t.run(`INSERT INTO ratings (id, job_id, customer_id, partner_id, stars, tags, service_stars, review, private_note, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [newId(), job.id, user.id, job.partner_id, stars, JSON.stringify(tags), serviceStars ? JSON.stringify(serviceStars) : null, review, privateNote, now()]);
        if (favorite) await t.run(`INSERT INTO favorite_partners (customer_id, partner_id, created_at) VALUES ($1, $2, $3) ON CONFLICT (customer_id, partner_id) DO NOTHING`, [user.id, job.partner_id, now()]);
      });
      const tip = tipCents > 0 ? await chargeTip(job, tipCents) : null;
      const tipped = tip && tip.status !== "failed";
      await tell(db, job.partner_id, {
        category: "reviews",
        title: `New ${stars}-star rating${tipped ? ` and a ${fmtMoney(tip.amountCents)} tip` : ""}`,
        body: `${shortName(await userRow(user.id))} rated your ${fmtDate(job.completed_at)} ${servicesOf(job).join(", ")}.${review ? ` "${review.slice(0, 140)}"` : ""}`,
        data: { route: "/reviews" },
      });
      await checkPartnerStanding(job.partner_id);
      return { rating: await api.ratingFor(job.id), tip, favorite };
    },

    // A tip on its own, within 24 hours (if they rated without one, or the card was declined).
    async tip(user, jobId, b) {
      const job = await customerJob(user, jobId);
      if (job.status !== "completed" || !job.partner_id) throw conflict("You can tip once the visit is done.");
      if (now() - job.completed_at > TIP_HOURS * HOUR) throw conflict(`Tips close ${TIP_HOURS} hours after the visit.`);
      const cents = Number(b.tipCents);
      if (!Number.isInteger(cents) || cents < 100) throw bad("tipCents", "Choose a tip of at least $1.");
      if (cents > tipMax(job)) throw bad("tipCents", `Tips can be up to ${fmtMoney(tipMax(job))}.`);
      const tip = await chargeTip(job, cents);
      if (tip.status === "failed") throw new HttpError(402, "card_declined", tip.message || "Your card was declined. Add a different card and try again.");
      await tell(db, job.partner_id, { category: "reviews", title: `You got a ${fmtMoney(cents)} tip`, body: `From ${shortName(await userRow(user.id))} for your ${fmtDate(job.completed_at)} visit. 100% is yours.`, data: { route: "/payouts" } });
      return { tip };
    },

    async ratingFor(jobId) {
      const r = await db.get(`SELECT * FROM ratings WHERE job_id = $1`, [jobId]);
      return r ? { stars: r.stars, tags: J(r.tags, []), serviceStars: J(r.service_stars), review: r.review, at: r.created_at } : null;
    },

    // ---------- Partner: rate the customer (private) and see their reviews ----------
    async rateCustomer(user, jobId, b) {
      const job = await partnerJob(user, jobId);
      if (job.status !== "completed") throw conflict("You can rate the customer once the job is done.");
      if (now() - job.completed_at > PARTNER_RATE_DAYS * DAY) throw conflict(`Customer ratings close ${PARTNER_RATE_DAYS} days after the job.`);
      const stars = Number(b.stars);
      if (!Number.isInteger(stars) || stars < 1 || stars > 5) throw bad("stars", "Tap a star.");
      const r = await db.run(`INSERT INTO customer_ratings (job_id, partner_id, customer_id, stars, created_at) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (job_id) DO NOTHING`,
        [job.id, user.id, job.customer_id, stars, now()]);
      if (!r.changes) throw conflict("You already rated this customer.");
      return { ok: true, stars };
    },

    async reviewsFor(user) {
      const summary = await ratingSummary(db, user.id);
      const recent = await db.all(`SELECT stars, tags FROM ratings WHERE partner_id = $1 ORDER BY created_at DESC LIMIT ${RATING_WINDOW}`, [user.id]);
      const dist = [5, 4, 3, 2, 1].map((s) => ({ stars: s, pct: recent.length ? Math.round((recent.filter((r) => r.stars === s).length / recent.length) * 100) : 0 }));
      const tagCount = {};
      for (const r of recent) for (const x of J(r.tags, [])) if (POS_TAGS.includes(x)) tagCount[x] = (tagCount[x] || 0) + 1;
      const rows = await db.all(`SELECT r.*, u.first_name, u.last_name, j.final FROM ratings r JOIN users u ON u.id = r.customer_id JOIN jobs j ON j.id = r.job_id WHERE r.partner_id = $1 ORDER BY r.created_at DESC LIMIT 30`, [user.id]);
      const tips = Number((await db.get(`SELECT COALESCE(SUM(amount_cents), 0) AS c FROM tips WHERE partner_id = $1 AND status <> 'failed' AND created_at >= $2`, [user.id, now() - 30 * DAY])).c);
      return {
        average: summary.average, count: summary.count, distribution: dist, reviewThreshold: REVIEW_BELOW,
        mentions: Object.entries(tagCount).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([tag, n]) => ({ tag, count: n })),
        reviews: rows.map((r) => ({ name: shortName(r), stars: r.stars, review: r.hidden_at ? null : r.review, tags: J(r.tags, []), services: (J(r.final, {}).lines || []).map((l) => l.name), at: r.created_at })),
        tipsLast30DaysCents: tips,
      };
    },

    // ---------- Claims: customer side ----------
    async fileClaim(user, b) {
      const job = await customerJob(user, b.jobId);
      if (job.status !== "completed" || !job.partner_id) throw bad("jobId", "Choose a finished visit.");
      if (now() - job.completed_at > CLAIM_DAYS * DAY) throw bad("jobId", `Claims need to be filed within ${CLAIM_DAYS} days of the visit. Chat with support about older visits.`);
      if (await db.get(`SELECT id FROM claims WHERE job_id = $1 AND status <> 'closed'`, [job.id])) throw conflict("There's already an open claim for this visit. Open it from Help & claims.");
      if (!DAMAGE_TO[b.damageTo]) throw bad("damageTo", "Choose what was damaged.");
      if (!WANTS[b.wants]) throw bad("wants", "Choose what would make it right.");
      const description = text(b.description, "description", { min: 15, max: 2000, msg: "Describe what happened in a sentence or two." });
      const estimate = parseMoney(b.estimate, "estimate");
      const files = photos ? photos.decodeAll(b.photos, "photos", { min: 1, max: 6, minMsg: "Add at least one photo of the damage." }) : [];
      const coverage = await coverageOf(job.partner_id);
      let id;
      let number;
      for (let attempt = 0; ; attempt++) {
        id = newId();
        number = await nextClaimNumber();
        try {
          await db.tx(async (t) => {
            await t.run(
              `INSERT INTO claims (id, number, job_id, customer_id, partner_id, damage_to, description, wants, estimate_cents, coverage, status, response_due_at, created_at, updated_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'partner', $11, $12, $12)`,
              [id, number, job.id, user.id, job.partner_id, b.damageTo, description, b.wants, estimate, coverage, now() + RESPONSE_HOURS * HOUR, now()],
            );
            if (photos) await photos.attach(t, "claim", id, files, user);
            await t.run(`INSERT INTO job_events (id, job_id, actor_id, kind, data, created_at) VALUES ($1, $2, $3, 'claim_filed', $4, $5)`,
              [`${String(now()).padStart(15, "0")}-${newId().slice(0, 8)}`, job.id, user.id, JSON.stringify({ claimId: id, number: claimNo(number) }), now()]);
            await tell(t, job.partner_id, {
              category: "claims", title: `Damage claim ${claimNo(number)}`,
              body: `${shortName(await t.get(`SELECT first_name, last_name FROM users WHERE id = $1`, [user.id]))} reported damage to ${b.damageTo === "vehicle" ? "their vehicle" : b.damageTo === "property" ? "their property" : "something"} after your ${fmtDate(job.completed_at)} job. Respond within ${RESPONSE_HOURS} hours. Only this job's pay is on hold until it's decided.`,
              data: { route: "/claim", params: { id } },
            });
            await tell(t, user.id, { category: "claims", title: `Claim ${claimNo(number)} submitted`, body: `Your partner has ${RESPONSE_HOURS} hours to respond. We compare their check-in photos with yours and decide within 5 business days after that.`, data: { route: "/claim", params: { id } } });
          });
          break;
        } catch (e) {
          if (attempt < 2 && /unique|duplicate/i.test(e.message)) continue;
          throw e;
        }
      }
      return api.claimForCustomer(user, id);
    },
    async claimsForCustomer(user) {
      const rows = await db.all(`SELECT * FROM claims WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 50`, [user.id]);
      return Promise.all(rows.map((c) => claimOut(c, { forRole: "customer" })));
    },
    async claimForCustomer(user, id) {
      const c = await db.get(`SELECT * FROM claims WHERE id = $1 AND customer_id = $2`, [String(id), user.id]);
      if (!c) throw notFound("That claim");
      return claimOut(c, { forRole: "customer" });
    },
    // Visits a customer can file a claim on.
    async claimableJobs(user) {
      const rows = await db.all(`SELECT * FROM jobs WHERE customer_id = $1 AND status = 'completed' AND completed_at >= $2 ORDER BY completed_at DESC LIMIT 30`, [user.id, now() - CLAIM_DAYS * DAY]);
      const out = [];
      for (const j of rows) {
        const p = j.partner_id ? await userRow(j.partner_id) : null;
        const v = await db.get(`SELECT year, make, model FROM vehicles WHERE id = $1`, [j.vehicle_id]);
        out.push({ id: j.id, completedAt: j.completed_at, services: servicesOf(j), partner: shortName(p), vehicle: v ? `${v.year} ${v.make} ${v.model}` : null });
      }
      return out;
    },

    // ---------- Claims: partner side ----------
    async claimsForPartner(user) {
      const rows = await db.all(`SELECT * FROM claims WHERE partner_id = $1 ORDER BY CASE status WHEN 'partner' THEN 0 WHEN 'review' THEN 1 ELSE 2 END, created_at DESC LIMIT 50`, [user.id]);
      return Promise.all(rows.map((c) => claimOut(c, { forRole: "partner" })));
    },
    async claimForPartner(user, id) {
      const c = await db.get(`SELECT * FROM claims WHERE id = $1 AND partner_id = $2`, [String(id), user.id]);
      if (!c) throw notFound("That claim");
      return claimOut(c, { forRole: "partner" });
    },
    async respond(user, id, b) {
      const c = await db.get(`SELECT * FROM claims WHERE id = $1 AND partner_id = $2`, [String(id), user.id]);
      if (!c) throw notFound("That claim");
      if (c.status === "closed") throw conflict("This claim is already decided.");
      if (c.responded_at) throw conflict("You already responded. Chat with partner support to add more.");
      const response = maskContacts(text(b.response, "response", { min: 20, max: 2000, msg: "Explain your side in a few sentences. Mention your check-in photos if they show the damage was already there." }));
      await db.run(`UPDATE claims SET partner_response = $1, responded_at = $2, status = 'review', updated_at = $2 WHERE id = $3`, [response, now(), c.id]);
      return api.claimForPartner(user, c.id);
    },

    // ---------- Time-based: claims with no partner answer go to review after 48 hours ----------
    async sweep() {
      const late = await db.all(`SELECT * FROM claims WHERE status = 'partner' AND response_due_at <= $1`, [now()]);
      for (const c of late) await db.run(`UPDATE claims SET status = 'review', updated_at = $1 WHERE id = $2 AND status = 'partner'`, [now(), c.id]);
      return { claimsToReview: late.length };
    },

    // ---------- Money partners owe ----------
    async debtsFor(partnerId) {
      const rows = await db.all(`SELECT * FROM partner_debts WHERE partner_id = $1 ORDER BY created_at DESC LIMIT 50`, [partnerId]);
      const list = rows.map(debtOut);
      return { owedCents: list.reduce((a, d) => a + d.owedCents, 0), debts: list };
    },

    // ---------- Staff ----------
    async staffClaims(filter = "open") {
      const where = { open: "status <> 'closed'", review: "status = 'review'", closed: "status = 'closed'", all: "1 = 1" }[filter];
      if (!where) throw bad("status", "Unknown filter.");
      const rows = await db.all(`SELECT * FROM claims WHERE ${where} ORDER BY CASE status WHEN 'review' THEN 0 WHEN 'partner' THEN 1 ELSE 2 END, created_at DESC LIMIT 200`);
      const out = [];
      for (const c of rows) {
        const [cu, pa] = await Promise.all([userRow(c.customer_id), userRow(c.partner_id)]);
        out.push({ id: c.id, number: claimNo(c.number), status: c.status, createdAt: c.created_at, customer: `${cu.first_name} ${cu.last_name}`, partner: `${pa.first_name} ${pa.last_name}`,
          damageTo: DAMAGE_TO[c.damage_to], estimateCents: c.estimate_cents, coverage: COVERAGE[c.coverage], responseDueAt: c.response_due_at, outcome: c.outcome ? OUTCOME[c.outcome] : null, amountCents: c.amount_cents });
      }
      return out;
    },
    async staffClaim(id) {
      const c = await db.get(`SELECT * FROM claims WHERE id = $1`, [String(id)]);
      if (!c) throw new HttpError(404, "not_found", "No claim with that ID.");
      return claimOut(c, { forRole: "staff" });
    },
    async decideClaim(staff, id, b) {
      const c = await db.get(`SELECT * FROM claims WHERE id = $1`, [String(id)]);
      if (!c) throw new HttpError(404, "not_found", "No claim with that ID.");
      if (c.status === "closed") throw conflict("This claim is already decided.");
      if (c.status === "partner" && b.force !== true) throw conflict("The partner can still respond. Wait until they do or their 48 hours run out.");
      if (!OUTCOME[b.outcome]) throw bad("outcome", "Choose an outcome.");
      const note = text(b.note, "note", { min: 20, max: 2000, msg: "Explain the decision in a sentence or two. Both sides see it." });
      const amount = b.outcome === "deny" ? null : parseMoney(b.amount, "amount", { max: 1_000_000 });
      if (b.outcome !== "deny" && !(amount > 0)) throw bad("amount", "Enter the amount.");
      let paidBy = null;
      if (b.outcome === "pay") {
        const allowed = c.coverage === "protection" ? ["protection"] : ["own_insurer", "auto_auto"];
        paidBy = allowed.includes(b.paidBy) ? b.paidBy : null;
        if (!paidBy) throw bad("paidBy", "Choose who pays.");
      }
      const s = await currentSettings();
      await db.tx(async (t) => {
        await t.run(`UPDATE claims SET status = 'closed', outcome = $1, amount_cents = $2, paid_by = $3, decision_note = $4, decided_by = $5, decided_at = $6, updated_at = $6 WHERE id = $7`,
          [b.outcome, amount, paidBy, note, staff.id, now(), c.id]);
        if (b.outcome === "pay" && paidBy === "protection") {
          await addDebt(t, { partnerId: c.partner_id, reason: `Deductible for ${claimNo(c.number)}`, claimId: c.id, jobId: c.job_id, cents: Math.min(amount, Math.round(s.deductible * 100)) });
        }
        if (b.outcome === "pay" && paidBy === "auto_auto") {
          await addDebt(t, { partnerId: c.partner_id, reason: `${claimNo(c.number)} paid by Auto-Auto`, claimId: c.id, jobId: c.job_id, cents: amount });
        }
        if (b.outcome === "goodwill") {
          await t.run(`INSERT INTO customer_credits (id, user_id, cents, reason, job_id, created_at) VALUES ($1, $2, $3, $4, $5, $6)`, [newId(), c.customer_id, amount, `Goodwill credit for ${claimNo(c.number)}`, c.job_id, now()]);
        }
        const custMsg = b.outcome === "pay" ? `Approved for ${fmtMoney(amount)}. Our claims team will contact you to arrange the ${c.wants === "repair" ? "repair" : "payment"}.`
          : b.outcome === "goodwill" ? `We added a ${fmtMoney(amount)} credit to your account. It comes off your next visit.`
            : "Denied.";
        await tell(t, c.customer_id, { category: "claims", title: `Claim ${claimNo(c.number)} decided`, body: `${custMsg} ${note}`, data: { route: "/claim", params: { id: c.id } } });
        const debtMsg = b.outcome === "pay" && paidBy === "protection" ? ` Your ${fmtMoney(Math.min(amount, Math.round(s.deductible * 100)))} deductible comes out of future payouts, never more than ${s.recoverMax}% of any one.`
          : b.outcome === "pay" && paidBy === "auto_auto" ? ` Auto-Auto paid ${fmtMoney(amount)} and recovers it from future payouts, never more than ${s.recoverMax}% of any one.` : "";
        await tell(t, c.partner_id, { category: "claims", title: `Claim ${claimNo(c.number)} decided: ${OUTCOME[b.outcome]}`, body: `${note}${debtMsg} The pay held for this job is released.`, data: { route: "/claim", params: { id: c.id } } });
      });
      log(`[claims] ${claimNo(c.number)} ${b.outcome} by ${staff.id}`);
      return api.staffClaim(c.id);
    },

    async staffWarranty() {
      const rows = await db.all(`SELECT w.*, j.status AS return_status, j.partner_id AS return_partner, j.window_start, o.final AS orig_final, o.completed_at AS orig_done
        FROM warranty_returns w JOIN jobs j ON j.id = w.return_job_id JOIN jobs o ON o.id = w.original_job_id ORDER BY w.created_at DESC LIMIT 200`);
      const out = [];
      for (const w of rows) {
        const [cu, op, rp] = await Promise.all([userRow(w.customer_id), userRow(w.original_partner_id), w.return_partner ? userRow(w.return_partner) : null]);
        const debt = await db.get(`SELECT * FROM partner_debts WHERE job_id = $1 AND partner_id = $2`, [w.return_job_id, w.original_partner_id]);
        out.push({
          id: w.id, returnJobId: w.return_job_id, originalJobId: w.original_job_id, customer: `${cu.first_name} ${cu.last_name}`, originalPartner: `${op.first_name} ${op.last_name}`,
          returnPartner: rp ? `${rp.first_name} ${rp.last_name}` : null, samePartner: w.return_partner === w.original_partner_id, originalServices: (J(w.orig_final, {}).lines || []).map((l) => l.name),
          originalDoneAt: w.orig_done, issue: w.issue, details: w.details, status: w.return_status, windowStart: w.window_start, chargeBack: !!w.charge_back, debt: debt ? debtOut(debt) : null, createdAt: w.created_at,
        });
      }
      return out;
    },
    // Staff decide whether the original partner pays when someone else did the warranty work.
    async setChargeBack(staff, id, b) {
      if (typeof b.chargeBack !== "boolean") throw bad("chargeBack", "Choose yes or no.");
      const w = await db.get(`SELECT * FROM warranty_returns WHERE id = $1`, [String(id)]);
      if (!w) throw new HttpError(404, "not_found", "No warranty return with that ID.");
      await db.run(`UPDATE warranty_returns SET charge_back = $1 WHERE id = $2`, [b.chargeBack ? 1 : 0, w.id]);
      await db.run(`UPDATE partner_debts SET waived_at = $1, waived_by = $2 WHERE job_id = $3 AND partner_id = $4`,
        [b.chargeBack ? null : now(), b.chargeBack ? null : staff.id, w.return_job_id, w.original_partner_id]);
      return (await api.staffWarranty()).find((x) => x.id === w.id);
    },
    async waiveDebt(staff, id, b) {
      const d = await db.get(`SELECT * FROM partner_debts WHERE id = $1`, [String(id)]);
      if (!d) throw new HttpError(404, "not_found", "No balance with that ID.");
      const waive = b.waive !== false;
      await db.run(`UPDATE partner_debts SET waived_at = $1, waived_by = $2 WHERE id = $3`, [waive ? now() : null, waive ? staff.id : null, d.id]);
      return debtOut(await db.get(`SELECT * FROM partner_debts WHERE id = $1`, [d.id]));
    },
    async staffDebts() {
      const rows = await db.all(`SELECT d.*, u.first_name, u.last_name FROM partner_debts d JOIN users u ON u.id = d.partner_id ORDER BY d.created_at DESC LIMIT 200`);
      return rows.map((d) => ({ ...debtOut(d), partner: `${d.first_name} ${d.last_name}`, partnerId: d.partner_id }));
    },

    async staffRatings(filter = "low") {
      const where = filter === "low" ? "r.stars <= 2" : "1 = 1";
      const rows = await db.all(`SELECT r.*, c.first_name AS cf, c.last_name AS cl, p.first_name AS pf, p.last_name AS pl FROM ratings r JOIN users c ON c.id = r.customer_id JOIN users p ON p.id = r.partner_id WHERE ${where} ORDER BY CASE WHEN r.followed_up_at IS NULL THEN 0 ELSE 1 END, r.created_at DESC LIMIT 200`);
      return rows.map((r) => ({
        id: r.id, jobId: r.job_id, stars: r.stars, tags: J(r.tags, []), review: r.review, privateNote: r.private_note, customer: `${r.cf} ${r.cl}`, partner: `${r.pf} ${r.pl}`, partnerId: r.partner_id,
        followedUp: !!r.followed_up_at, hidden: !!r.hidden_at, hiddenReason: r.hidden_reason, at: r.created_at,
      }));
    },
    async followUp(staff, id) {
      const r = await db.run(`UPDATE ratings SET followed_up_at = $1, followed_up_by = $2 WHERE id = $3`, [now(), staff.id, String(id)]);
      if (!r.changes) throw new HttpError(404, "not_found", "No rating with that ID.");
      return { ok: true };
    },
    async hideReview(staff, id, b) {
      const reason = text(b.reason, "reason", { min: 5, max: 300, msg: "Say why the review is hidden." });
      const r = await db.run(`UPDATE ratings SET hidden_at = $1, hidden_reason = $2 WHERE id = $3`, [now(), reason, String(id)]);
      if (!r.changes) throw new HttpError(404, "not_found", "No rating with that ID.");
      return { ok: true };
    },
  };
  return api;
}
