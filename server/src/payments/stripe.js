// Small Stripe client over Stripe's REST API (no SDK, to keep dependencies minimal).
// Needs STRIPE_SECRET_KEY. Card numbers never touch our server: cards are saved on Stripe's own checkout page.

export class StripeError extends Error {
  constructor(message, { status, code, declineCode, type, raw } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.declineCode = declineCode;
    this.type = type;
    this.raw = raw;
  }
}

// Stripe takes form-encoded bodies with nested keys: metadata[job_id]=..., payment_method_types[0]=card
export function formEncode(obj, prefix, out = []) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === "object" && !Array.isArray(v)) formEncode(v, key, out);
    else if (Array.isArray(v)) v.forEach((x, i) => (typeof x === "object" ? formEncode(x, `${key}[${i}]`, out) : out.push(`${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(x)}`)));
    else out.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
  }
  return out.join("&");
}

// Plain-English messages for card problems (RULES: say how to fix it).
export function cardMessage(e) {
  const c = e.declineCode || e.code;
  if (c === "insufficient_funds") return "Your card was declined for insufficient funds. Try another card.";
  if (c === "expired_card") return "Your card has expired. Add a new card and try again.";
  if (c === "incorrect_cvc" || c === "incorrect_number") return "Your card details didn't match. Add the card again and try once more.";
  if (c === "authentication_required") return "Your bank wants to confirm this payment. Add the card again in the app to approve it, then try again.";
  if (e.type === "card_error") return "Your card was declined. Try another card or call your bank.";
  return "We couldn't reach our payment processor. Try again in a minute.";
}

export function createStripe({ secretKey, fetchImpl = globalThis.fetch, baseUrl = "https://api.stripe.com", timeoutMs = 20_000 }) {
  if (!secretKey) return null;
  async function req(method, path, params, { idempotencyKey, query } = {}) {
    const headers = { Authorization: `Bearer ${secretKey}`, "Stripe-Version": "2024-06-20" };
    let url = baseUrl + path;
    let body;
    if (method === "GET") { const q = formEncode(query || params || {}); if (q) url += `?${q}`; }
    else { body = formEncode(params || {}); headers["Content-Type"] = "application/x-www-form-urlencoded"; }
    if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res;
    try {
      res = await fetchImpl(url, { method, headers, body, signal: ctrl.signal });
    } catch (e) {
      throw new StripeError("Payment processor unreachable", { status: 0, code: "network" });
    } finally {
      clearTimeout(timer);
    }
    const data = await res.json().catch(() => ({}));
    if (res.status >= 400) {
      const er = data.error || {};
      throw new StripeError(er.message || "Stripe error", { status: res.status, code: er.code, declineCode: er.decline_code, type: er.type, raw: er });
    }
    return data;
  }
  return {
    createCustomer: (p) => req("POST", "/v1/customers", p),
    createSetupCheckout: (p) => req("POST", "/v1/checkout/sessions", { mode: "setup", currency: "usd", payment_method_types: ["card"], ...p }),
    getCheckoutSession: (id) => req("GET", `/v1/checkout/sessions/${encodeURIComponent(id)}`, null, { query: { expand: ["setup_intent"] } }),
    listCards: (customer) => req("GET", `/v1/customers/${encodeURIComponent(customer)}/payment_methods`, null, { query: { type: "card", limit: 20 } }),
    detachCard: (pm) => req("POST", `/v1/payment_methods/${encodeURIComponent(pm)}/detach`, {}),
    // Charges or holds a saved card without the customer present.
    createPaymentIntent: (p, idempotencyKey) => req("POST", "/v1/payment_intents", { currency: "usd", off_session: true, confirm: true, ...p }, { idempotencyKey }),
    capture: (id, amount, idempotencyKey) => req("POST", `/v1/payment_intents/${encodeURIComponent(id)}/capture`, amount != null ? { amount_to_capture: amount } : {}, { idempotencyKey }),
    cancelPaymentIntent: (id) => req("POST", `/v1/payment_intents/${encodeURIComponent(id)}/cancel`, {}),
    refund: (p, idempotencyKey) => req("POST", "/v1/refunds", p, { idempotencyKey }),
    // Partner payouts (Connect Express).
    createAccount: (p) => req("POST", "/v1/accounts", { type: "express", country: "US", capabilities: { transfers: { requested: true } }, ...p }),
    getAccount: (id) => req("GET", `/v1/accounts/${encodeURIComponent(id)}`),
    accountLink: (p) => req("POST", "/v1/account_links", { type: "account_onboarding", ...p }),
    loginLink: (id) => req("POST", `/v1/accounts/${encodeURIComponent(id)}/login_links`, {}),
    transfer: (p, idempotencyKey) => req("POST", "/v1/transfers", { currency: "usd", ...p }, { idempotencyKey }),
  };
}
