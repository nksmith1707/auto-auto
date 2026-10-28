// Money for each job (RULES.md, Booking and payment; Partner pay) and partner payouts.
// Works without Stripe too (local development): partner earnings are still recorded, nothing is charged.
import { HttpError } from "../lib/http.js";
import { newId } from "../auth/tokens.js";
import { StripeError, cardMessage } from "./stripe.js";

const HOUR = 3_600_000;
const J = (s, d = null) => (s ? JSON.parse(s) : d);

export function createPayments({ db, stripe, settings, now = () => Date.now(), log = () => {} }) {
  const enabled = !!stripe;
  const pid = () => `${String(now()).padStart(15, "0")}-${newId().slice(0, 8)}`;

  // ---------- Cards ----------
  async function customerId(user) {
    const row = await db.get(`SELECT stripe_customer_id FROM stripe_customers WHERE user_id = $1`, [user.id]);
    if (row) return row.stripe_customer_id;
    const c = await stripe.createCustomer({ email: user.email, name: `${user.first_name} ${user.last_name}`, metadata: { user_id: user.id } });
    await db.run(`INSERT INTO stripe_customers (user_id, stripe_customer_id, created_at) VALUES ($1, $2, $3) ON CONFLICT (user_id) DO NOTHING`, [user.id, c.id, now()]);
    return (await db.get(`SELECT stripe_customer_id FROM stripe_customers WHERE user_id = $1`, [user.id])).stripe_customer_id;
  }

  const cardOut = (c) => ({ id: c.id, brand: c.brand, last4: c.last4, expMonth: c.exp_month, expYear: c.exp_year, isDefault: !!c.is_default });
  const listCards = async (userId) => (await db.all(`SELECT * FROM cards WHERE user_id = $1 ORDER BY is_default DESC, created_at`, [userId])).map(cardOut);
  const defaultCard = (userId) => db.get(`SELECT * FROM cards WHERE user_id = $1 ORDER BY is_default DESC, created_at LIMIT 1`, [userId]);
  const need = () => { if (!enabled) throw new HttpError(503, "payments_off", "Payments aren't turned on yet."); };

  // Pulls the customer's saved cards from Stripe. Card numbers stay with Stripe; we keep brand, last 4, and expiry.
  async function syncCards(user) {
    need();
    const cus = await customerId(user);
    const list = await stripe.listCards(cus);
    const ids = new Set();
    for (const pm of list.data || []) {
      ids.add(pm.id);
      const c = pm.card || {};
      await db.run(
        `INSERT INTO cards (id, user_id, brand, last4, exp_month, exp_year, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (id) DO UPDATE SET brand = excluded.brand, last4 = excluded.last4, exp_month = excluded.exp_month, exp_year = excluded.exp_year`,
        [pm.id, user.id, c.brand || "card", c.last4 || "????", c.exp_month || 0, c.exp_year || 0, now()],
      );
    }
    for (const c of await db.all(`SELECT id FROM cards WHERE user_id = $1`, [user.id])) if (!ids.has(c.id)) await db.run(`DELETE FROM cards WHERE id = $1`, [c.id]);
    if (!(await db.get(`SELECT id FROM cards WHERE user_id = $1 AND is_default = 1`, [user.id]))) {
      const newest = await db.get(`SELECT id FROM cards WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`, [user.id]);
      if (newest) await db.run(`UPDATE cards SET is_default = 1 WHERE id = $1`, [newest.id]);
    }
    // A new card may fix a hold or charge that failed.
    await retryCardProblems(user.id);
    return listCards(user.id);
  }

  // ---------- Charging ----------
  function rowOut(p, cards) {
    const card = cards && cards.find((c) => c.id === p.card_id);
    return { id: p.id, kind: p.kind, amountCents: p.amount_cents, capturedCents: p.captured_cents, status: p.status, error: p.error, card: card ? `${card.brand[0].toUpperCase()}${card.brand.slice(1)} •••• ${card.last4}` : null, at: p.created_at };
  }

  async function record(jobId, userId, kind, fields) {
    const id = pid();
    await db.run(
      `INSERT INTO payments (id, job_id, user_id, kind, stripe_id, card_id, amount_cents, captured_cents, status, error, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)`,
      [id, jobId, userId, kind, fields.stripeId || null, fields.cardId || null, fields.amount, fields.captured || 0, fields.status, fields.error || null, now()],
    );
    return id;
  }

  // Charges (or holds, when hold=true) the customer's default card. Never throws for card problems.
  async function chargeCard(job, kind, amount, { hold = false, description } = {}) {
    if (!enabled || amount <= 0) return { ok: true, skipped: true };
    const card = await defaultCard(job.customer_id);
    if (!card) {
      await record(job.id, job.customer_id, kind, { amount, status: "failed", error: "No card on file" });
      return { ok: false, message: "Add a card to your account to pay for this visit." };
    }
    const cus = (await db.get(`SELECT stripe_customer_id FROM stripe_customers WHERE user_id = $1`, [job.customer_id])).stripe_customer_id;
    const n = Number((await db.get(`SELECT COUNT(*) AS n FROM payments WHERE job_id = $1 AND kind = $2`, [job.id, kind])).n);
    try {
      const pi = await stripe.createPaymentIntent({
        amount, customer: cus, payment_method: card.id, capture_method: hold ? "manual" : "automatic",
        description: description || `Auto-Auto ${kind}`, metadata: { job_id: job.id, kind },
      }, `${job.id}:${kind}:${n}`);
      const ok = hold ? pi.status === "requires_capture" : pi.status === "succeeded";
      if (!ok) {
        await record(job.id, job.customer_id, kind, { stripeId: pi.id, cardId: card.id, amount, status: "failed", error: pi.status });
        return { ok: false, message: "Your bank needs to approve this payment. Add the card again in the app, then try again." };
      }
      await record(job.id, job.customer_id, kind, { stripeId: pi.id, cardId: card.id, amount, captured: hold ? 0 : amount, status: hold ? "held" : "succeeded" });
      return { ok: true, stripeId: pi.id };
    } catch (e) {
      if (!(e instanceof StripeError)) throw e;
      log(`[payments] ${kind} failed for job ${job.id}: ${e.code || e.message}`);
      await record(job.id, job.customer_id, kind, { cardId: card.id, amount, status: "failed", error: e.declineCode || e.code || e.message });
      return { ok: false, message: cardMessage(e) };
    }
  }

  const paymentsOf = (jobId) => db.all(`SELECT * FROM payments WHERE job_id = $1 ORDER BY id`, [jobId]);
  const paidSoFar = (rows) => rows.filter((p) => ["deposit", "charge", "fee"].includes(p.kind) && p.status === "succeeded").reduce((a, p) => a + p.amount_cents, 0)
    + rows.filter((p) => p.kind === "hold" && p.status === "captured").reduce((a, p) => a + p.captured_cents, 0)
    - rows.filter((p) => p.kind === "refund" && p.status === "succeeded").reduce((a, p) => a + p.amount_cents, 0);

  async function releaseHolds(jobId) {
    for (const h of await db.all(`SELECT * FROM payments WHERE job_id = $1 AND kind = 'hold' AND status = 'held'`, [jobId])) {
      try { if (enabled) await stripe.cancelPaymentIntent(h.stripe_id); } catch (e) { log(`[payments] couldn't release hold ${h.id}: ${e.message}`); }
      await db.run(`UPDATE payments SET status = 'released', updated_at = $1 WHERE id = $2`, [now(), h.id]);
    }
  }

  // Refunds up to `amount` across what the customer already paid on this job.
  async function refund(job, amount, reason) {
    if (!enabled || amount <= 0) return 0;
    let left = amount;
    const rows = await paymentsOf(job.id);
    for (const p of rows.filter((x) => (["deposit", "charge", "fee"].includes(x.kind) && x.status === "succeeded") || (x.kind === "hold" && x.status === "captured"))) {
      if (left <= 0) break;
      const refundedAlready = rows.filter((r) => r.kind === "refund" && r.stripe_id === p.stripe_id && r.status === "succeeded").reduce((a, r) => a + r.amount_cents, 0);
      const can = (p.kind === "hold" ? p.captured_cents : p.amount_cents) - refundedAlready;
      const amt = Math.min(can, left);
      if (amt <= 0) continue;
      try {
        await stripe.refund({ payment_intent: p.stripe_id, amount: amt, metadata: { job_id: job.id, reason } }, `${job.id}:refund:${p.id}:${amt}`);
        await record(job.id, job.customer_id, "refund", { stripeId: p.stripe_id, cardId: p.card_id, amount: amt, status: "succeeded" });
        left -= amt;
      } catch (e) {
        await record(job.id, job.customer_id, "refund", { stripeId: p.stripe_id, amount: amt, status: "failed", error: e.message });
      }
    }
    return amount - left;
  }

  async function setStatus(jobId, status) { await db.run(`UPDATE jobs SET payment_status = $1 WHERE id = $2`, [status, jobId]); }

  // ---------- Partner ledger ----------
  async function ledger(partnerId, jobId, kind, cents, note, payoutId = null) {
    if (!cents) return;
    await db.run(`INSERT INTO partner_ledger (id, partner_id, job_id, payout_id, kind, cents, note, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [pid(), partnerId, jobId, payoutId, kind, cents, note || null, now()]);
  }

  async function retryCardProblems(userId) {
    const jobs = await db.all(`SELECT * FROM jobs WHERE customer_id = $1 AND payment_status IN ('hold_failed', 'charge_failed')`, [userId]);
    for (const j of jobs) {
      if (j.payment_status === "hold_failed" && ["requested", "awaiting_approval", "confirmed", "en_route", "arrived", "in_progress"].includes(j.status)) await placeHold(j);
      if (j.payment_status === "charge_failed" && j.status === "completed") await collect(j);
      if (j.payment_status === "charge_failed" && j.status === "cancelled") await settleCancelled(j);
    }
  }

  // A cancelled job keeps only the fee: refund anything above it, or charge what's missing.
  async function settleCancelled(job) {
    const fee = job.cancel_fee_cents || 0;
    const paid = paidSoFar(await paymentsOf(job.id));
    let status = fee ? "paid" : paid ? "refunded" : null;
    if (paid > fee) await refund(job, paid - fee, "cancelled");
    else if (fee > paid) {
      const r = await chargeCard(job, "fee", fee - paid, { description: job.cancel_reason === "no_show" ? "Auto-Auto no-show fee" : "Auto-Auto cancellation fee" });
      if (!r.ok) status = "charge_failed";
    }
    await setStatus(job.id, status);
    return status !== "charge_failed";
  }

  async function placeHold(job) {
    const quote = J(job.quote);
    const rows = await paymentsOf(job.id);
    if (rows.some((p) => p.kind === "hold" && p.status === "held")) return { ok: true };
    const amount = quote.totalCents - paidSoFar(rows);
    const r = await chargeCard(job, "hold", amount, { hold: true, description: "Auto-Auto estimate hold" });
    // Nothing left to hold (the deposit covers it) still counts as held, so it isn't tried again.
    await setStatus(job.id, r.ok ? "held" : "hold_failed");
    return r;
  }

  // Charges what's still owed on a completed job: capture the hold first, then charge the rest.
  async function collect(job) {
    const final = J(job.final);
    const rows = await paymentsOf(job.id);
    let owed = final.chargeCents - paidSoFar(rows);
    if (owed < 0) { await refund(job, -owed, "final total lower than deposit"); await setStatus(job.id, "paid"); return { ok: true }; }
    const hold = rows.find((p) => p.kind === "hold" && p.status === "held");
    if (hold && owed > 0) {
      const amt = Math.min(owed, hold.amount_cents);
      try {
        await stripe.capture(hold.stripe_id, amt, `${job.id}:capture:${hold.id}`);
        await db.run(`UPDATE payments SET status = 'captured', captured_cents = $1, updated_at = $2 WHERE id = $3`, [amt, now(), hold.id]);
        owed -= amt;
      } catch (e) {
        log(`[payments] capture failed for job ${job.id}: ${e.message}`);
        await db.run(`UPDATE payments SET status = 'released', error = $1, updated_at = $2 WHERE id = $3`, [e.code || e.message, now(), hold.id]);
      }
    } else if (hold) await releaseHolds(job.id);
    if (owed > 0) {
      const r = await chargeCard(job, "charge", owed, { description: "Auto-Auto visit" });
      if (!r.ok) { await setStatus(job.id, "charge_failed"); return r; }
    }
    await setStatus(job.id, "paid");
    return { ok: true };
  }

  // ---------- Payouts ----------
  async function balanceOf(partnerId) {
    const rows = await db.all(`SELECT kind, SUM(cents) AS c FROM partner_ledger WHERE partner_id = $1 GROUP BY kind`, [partnerId]);
    const by = Object.fromEntries(rows.map((r) => [r.kind, Number(r.c)]));
    const total = Object.values(by).reduce((a, b) => a + b, 0);
    return { availableCents: total, reserveCents: -((by.reserve || 0) + (by.reserve_release || 0)), earnedCents: (by.earnings || 0) + (by.fee_share || 0), partsCents: by.parts || 0 };
  }
  const jobsDone = async (partnerId) => Number((await db.get(`SELECT COUNT(*) AS n FROM jobs WHERE partner_id = $1 AND status = 'completed'`, [partnerId])).n);

  async function payOut(partnerId, kind, s) {
    const acct = await db.get(`SELECT * FROM payout_accounts WHERE user_id = $1`, [partnerId]);
    if (!enabled || !acct || !acct.payouts_enabled) return { ok: false, message: "Set up payouts first so we know where to send your money." };
    const done = await jobsDone(partnerId);
    // New partners: a reserve is held until daily payouts unlock, then paid back.
    if (done >= s.dailyAfter) {
      const { reserveCents } = await balanceOf(partnerId);
      if (reserveCents > 0) await ledger(partnerId, null, "reserve_release", reserveCents, "Reserve paid back: daily payouts unlocked");
    }
    let { availableCents } = await balanceOf(partnerId);
    if (availableCents <= 0) return { ok: false, message: "There's nothing to pay out yet." };
    const fee = kind === "instant" ? Math.round(s.instantFee * 100) : 0;
    let reserve = 0;
    if (done < s.dailyAfter) reserve = Math.round(availableCents * s.reservePct / 100);
    const amount = availableCents - reserve - fee;
    if (amount <= 0) return { ok: false, message: `Your balance is less than the ${kind === "instant" ? "cash-out fee" : "minimum"}.` };
    const payoutId = pid();
    try {
      const tr = await stripe.transfer({ amount, destination: acct.stripe_account_id, metadata: { partner_id: partnerId, payout_id: payoutId, kind } }, `payout:${payoutId}`);
      await db.run(`INSERT INTO payouts (id, partner_id, kind, amount_cents, fee_cents, stripe_transfer_id, status, created_at) VALUES ($1, $2, $3, $4, $5, $6, 'paid', $7)`, [payoutId, partnerId, kind, amount, fee, tr.id, now()]);
      if (reserve) await ledger(partnerId, null, "reserve", -reserve, `${s.reservePct}% new-partner reserve`, payoutId);
      if (fee) await ledger(partnerId, null, "cashout_fee", -fee, "Instant cash-out fee", payoutId);
      await ledger(partnerId, null, "payout", -amount, `${kind[0].toUpperCase()}${kind.slice(1)} payout`, payoutId);
      return { ok: true, amountCents: amount, feeCents: fee, reserveCents: reserve };
    } catch (e) {
      log(`[payouts] transfer failed for ${partnerId}: ${e.message}`);
      await db.run(`INSERT INTO payouts (id, partner_id, kind, amount_cents, fee_cents, status, error, created_at) VALUES ($1, $2, $3, $4, $5, 'failed', $6, $7)`, [payoutId, partnerId, kind, amount, fee, e.message, now()]);
      return { ok: false, message: "The transfer didn't go through. We'll try again with the next payout." };
    }
  }

  // Eastern time parts for the payout schedule (Knoxville).
  function eastern(ms) {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hour12: false, weekday: "short" })
      .formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
    return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) % 24, weekday: p.weekday };
  }

  const api = {
    enabled,

    // ---------- Customer cards ----------
    listCards: (user) => listCards(user.id),
    syncCards,
    async startCardSetup(user, { returnTo, apiBase }) {
      need();
      const cus = await customerId(user);
      const back = `${apiBase}/pay/return?to=${encodeURIComponent(returnTo || "")}`;
      const session = await stripe.createSetupCheckout({ customer: cus, success_url: `${back}&ok=1`, cancel_url: back, metadata: { user_id: user.id } });
      return { url: session.url, sessionId: session.id };
    },
    async setDefaultCard(user, cardId) {
      const c = await db.get(`SELECT id FROM cards WHERE id = $1 AND user_id = $2`, [cardId, user.id]);
      if (!c) throw new HttpError(404, "not_found", "That card isn't on your account.");
      await db.run(`UPDATE cards SET is_default = CASE WHEN id = $1 THEN 1 ELSE 0 END WHERE user_id = $2`, [cardId, user.id]);
      await retryCardProblems(user.id);
      return listCards(user.id);
    },
    async removeCard(user, cardId) {
      need();
      const c = await db.get(`SELECT * FROM cards WHERE id = $1 AND user_id = $2`, [cardId, user.id]);
      if (!c) throw new HttpError(404, "not_found", "That card isn't on your account.");
      const open = await db.get(`SELECT COUNT(*) AS n FROM jobs WHERE customer_id = $1 AND status IN ('requested','awaiting_approval','confirmed','en_route','arrived','in_progress')`, [user.id]);
      const count = Number((await db.get(`SELECT COUNT(*) AS n FROM cards WHERE user_id = $1`, [user.id])).n);
      if (Number(open.n) && count === 1) throw new HttpError(409, "card_in_use", "You have a visit coming up. Add another card before removing this one.");
      await stripe.detachCard(cardId).catch((e) => log(`[payments] detach failed: ${e.message}`));
      await db.run(`DELETE FROM cards WHERE id = $1`, [cardId]);
      if (c.is_default) {
        const next = await db.get(`SELECT id FROM cards WHERE user_id = $1 ORDER BY created_at LIMIT 1`, [user.id]);
        if (next) await db.run(`UPDATE cards SET is_default = 1 WHERE id = $1`, [next.id]);
      }
      return listCards(user.id);
    },

    // ---------- Job money: called by the jobs service ----------
    // Before booking: a card must be on file (RULES: card is saved at booking).
    async requireCard(userId) {
      if (!enabled) return;
      if (!(await defaultCard(userId))) throw new HttpError(422, "card_required", "Add a card before booking. It's saved now and charged after the work.", { fields: { card: "Add a card to book." } });
    },
    // Right after booking: deposit for jobs over the threshold, and the estimate hold if the visit is soon.
    async afterBooking(job, s) {
      if (!enabled) return { ok: true };
      const quote = J(job.quote);
      if (quote.depositCents > 0) {
        const r = await chargeCard(job, "deposit", quote.depositCents, { description: "Auto-Auto deposit" });
        if (!r.ok) return r;
        await setStatus(job.id, "deposit_paid");
      }
      if (job.window_start - now() <= s.holdHrs * HOUR) {
        const h = await placeHold(job);
        if (!h.ok) return { ok: true, holdProblem: h.message };
      }
      return { ok: true };
    },
    // Every few minutes: place the estimate hold for visits starting within the hold window.
    async holdsDue(s) {
      if (!enabled) return 0;
      const due = await db.all(
        `SELECT * FROM jobs WHERE status IN ('requested','awaiting_approval','confirmed') AND window_start - $1 <= $2 AND (payment_status IS NULL OR payment_status = 'deposit_paid')`,
        [s.holdHrs * HOUR, now()],
      );
      for (const j of due) await placeHold(j);
      return due.length;
    },
    // Rescheduled to later: drop the hold so it's placed again closer to the new time (holds expire after about a week).
    async afterReschedule(job, s) {
      if (job.window_start - now() > s.holdHrs * HOUR) {
        await releaseHolds(job.id);
        if (job.payment_status === "held" || job.payment_status === "hold_failed") await setStatus(job.id, (await paymentsOf(job.id)).some((p) => p.kind === "deposit" && p.status === "succeeded") ? "deposit_paid" : null);
      }
    },
    // Cancelled or expired: release the hold, keep the fee, refund the rest. The partner's share of a fee goes to their ledger.
    async afterCancel(job) {
      if (job.partner_id && job.partner_comp_cents) await ledger(job.partner_id, job.id, "fee_share", job.partner_comp_cents, job.cancel_reason === "no_show" ? "No-show fee share" : "Cancellation fee share");
      if (!enabled) return;
      await releaseHolds(job.id);
      await settleCancelled(job);
    },
    // Completed: the partner is paid no matter what; then the customer is charged.
    async afterComplete(job) {
      const final = J(job.final);
      await ledger(job.partner_id, job.id, "earnings", final.partnerPay.earningsCents, "Job earnings");
      await ledger(job.partner_id, job.id, "parts", final.partnerPay.partsReimbursedCents, "Parts reimbursed at cost");
      if (!enabled) return { ok: true };
      return collect(job);
    },
    // Customer pays what's still owed after a failed charge.
    async retry(user, job) {
      need();
      if (job.customer_id !== user.id) throw new HttpError(404, "not_found", "That job isn't on your account.");
      if (!["hold_failed", "charge_failed"].includes(job.payment_status)) throw new HttpError(409, "nothing_due", "Nothing is due on this job.");
      await retryCardProblems(user.id);
      const after = await db.get(`SELECT payment_status FROM jobs WHERE id = $1`, [job.id]);
      if (["hold_failed", "charge_failed"].includes(after.payment_status)) throw new HttpError(402, "card_declined", "Your card was declined again. Add a different card and try again.");
      return { ok: true };
    },
    async summary(job, q = db) {
      const rows = await q.all(`SELECT * FROM payments WHERE job_id = $1 ORDER BY id`, [job.id]);
      const cards = await q.all(`SELECT * FROM cards WHERE user_id = $1`, [job.customer_id]);
      const paid = paidSoFar(rows);
      const due = job.status === "completed" && job.final ? Math.max(0, J(job.final).chargeCents - paid) : job.status === "cancelled" ? Math.max(0, (job.cancel_fee_cents || 0) - paid) : 0;
      return {
        enabled, status: job.payment_status, paidCents: paid, dueCents: due,
        heldCents: rows.filter((p) => p.kind === "hold" && p.status === "held").reduce((a, p) => a + p.amount_cents, 0),
        items: rows.filter((p) => p.status !== "failed").map((p) => rowOut(p, cards)),
        problem: ["hold_failed", "charge_failed"].includes(job.payment_status) ? (rows.filter((p) => p.status === "failed").pop() || {}).error || "declined" : null,
      };
    },

    // ---------- Fleet invoices (billed per visit, not per job) ----------
    hasCard: async (userId) => !!(await defaultCard(userId)),
    // Charges a customer's default card for an invoice. Never throws for card problems.
    async chargeInvoice(userId, amountCents, { key, description, metadata }) {
      if (!enabled) return { ok: false, message: "Payments aren't turned on yet." };
      const card = await defaultCard(userId);
      if (!card) return { ok: false, message: "Add a card to your account to pay this invoice." };
      const cus = (await db.get(`SELECT stripe_customer_id FROM stripe_customers WHERE user_id = $1`, [userId])).stripe_customer_id;
      try {
        const pi = await stripe.createPaymentIntent({ amount: amountCents, customer: cus, payment_method: card.id, capture_method: "automatic", description, metadata }, key);
        if (pi.status !== "succeeded") return { ok: false, message: "Your bank needs to approve this payment. Add the card again in the app, then try again." };
        return { ok: true, stripeId: pi.id, card: `${card.brand[0].toUpperCase()}${card.brand.slice(1)} •••• ${card.last4}` };
      } catch (e) {
        if (!(e instanceof StripeError)) throw e;
        log(`[payments] invoice charge failed: ${e.code || e.message}`);
        return { ok: false, message: cardMessage(e) };
      }
    },
    // Partner pay for a fleet visit goes to the same ledger as jobs.
    creditPartner: (partnerId, kind, cents, note) => ledger(partnerId, null, kind, cents, note),

    // ---------- Partner payouts ----------
    async payoutInfo(user) {
      const s = (await settings.current()).settings;
      const acct = await db.get(`SELECT * FROM payout_accounts WHERE user_id = $1`, [user.id]);
      const done = await jobsDone(user.id);
      const list = await db.all(`SELECT * FROM payouts WHERE partner_id = $1 ORDER BY created_at DESC LIMIT 20`, [user.id]);
      const recent = await db.all(`SELECT * FROM partner_ledger WHERE partner_id = $1 ORDER BY id DESC LIMIT 30`, [user.id]);
      return {
        enabled,
        account: acct ? { connected: true, payoutsEnabled: !!acct.payouts_enabled, detailsSubmitted: !!acct.details_submitted } : { connected: false, payoutsEnabled: false, detailsSubmitted: false },
        balance: await balanceOf(user.id),
        schedule: { kind: done >= s.dailyAfter ? "daily" : "weekly", jobsDone: done, dailyAfter: s.dailyAfter, reservePct: s.reservePct, instantFeeCents: Math.round(s.instantFee * 100), time: done >= s.dailyAfter ? "Every day at 9 PM" : "Mondays at 9 PM" },
        payouts: list.map((p) => ({ id: p.id, kind: p.kind, amountCents: p.amount_cents, feeCents: p.fee_cents, status: p.status, at: p.created_at })),
        activity: recent.map((l) => ({ kind: l.kind, cents: l.cents, note: l.note, jobId: l.job_id, at: l.created_at })),
      };
    },
    async startPayoutSetup(user, { returnTo, apiBase }) {
      need();
      let acct = await db.get(`SELECT * FROM payout_accounts WHERE user_id = $1`, [user.id]);
      if (!acct) {
        const a = await stripe.createAccount({ email: user.email, name: `${user.first_name} ${user.last_name}`, metadata: { user_id: user.id } });
        await db.run(`INSERT INTO payout_accounts (user_id, stripe_account_id, updated_at) VALUES ($1, $2, $3) ON CONFLICT (user_id) DO NOTHING`, [user.id, a.id, now()]);
        acct = await db.get(`SELECT * FROM payout_accounts WHERE user_id = $1`, [user.id]);
      }
      const back = `${apiBase}/pay/return?to=${encodeURIComponent(returnTo || "")}`;
      const link = await stripe.accountLink({ account: acct.stripe_account_id, refresh_url: back, return_url: `${back}&ok=1` });
      return { url: link.url };
    },
    async syncPayoutAccount(user) {
      need();
      const acct = await db.get(`SELECT * FROM payout_accounts WHERE user_id = $1`, [user.id]);
      if (!acct) return api.payoutInfo(user);
      const a = await stripe.getAccount(acct.stripe_account_id);
      await db.run(`UPDATE payout_accounts SET payouts_enabled = $1, details_submitted = $2, updated_at = $3 WHERE user_id = $4`, [a.payouts_enabled ? 1 : 0, a.details_submitted ? 1 : 0, now(), user.id]);
      return api.payoutInfo(user);
    },
    async cashOut(user) {
      need();
      const s = (await settings.current()).settings;
      const r = await payOut(user.id, "instant", s);
      if (!r.ok) throw new HttpError(409, "cannot_cash_out", r.message);
      return r;
    },
    // Daily at 9 PM Eastern for partners with enough jobs; Mondays at 9 PM for everyone else.
    async runScheduled() {
      if (!enabled) return { ran: [] };
      const t = eastern(now());
      if (t.hour < 21) return { ran: [] };
      const s = (await settings.current()).settings;
      const ran = [];
      for (const kind of t.weekday === "Mon" ? ["daily", "weekly"] : ["daily"]) {
        const runId = `${kind}:${t.date}`;
        const r = await db.run(`INSERT INTO payout_runs (id, created_at) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`, [runId, now()]);
        if (!r.changes) continue;
        const partners = await db.all(`SELECT a.user_id FROM payout_accounts a WHERE a.payouts_enabled = 1`);
        for (const p of partners) {
          const daily = (await jobsDone(p.user_id)) >= s.dailyAfter;
          if ((kind === "daily") !== daily) continue;
          await payOut(p.user_id, kind, s);
        }
        ran.push(runId);
      }
      return { ran };
    },
  };
  return api;
}
