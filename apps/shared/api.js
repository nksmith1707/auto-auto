// Auto-Auto API client shared by the customer and partner apps.
// Plain JavaScript with no React Native imports, so the same file runs in the apps and in Node tests.

export const DEFAULT_API_URL = "https://auto-auto-api.onrender.com";

export class ApiError extends Error {
  constructor({ status = 0, code = "unknown", message, fields = {}, retryAfter } = {}) {
    super(message || "Something went wrong. Try again.");
    this.status = status;
    this.code = code;
    this.fields = fields;
    this.retryAfter = retryAfter;
  }
}

const OFFLINE = "Can't reach Auto-Auto. Check your internet connection and try again.";
const SLOW = "Auto-Auto is taking too long to answer. Check your connection and try again.";

export function createApi({ baseUrl = DEFAULT_API_URL, fetchImpl = globalThis.fetch, timeoutMs = 20_000, userAgent } = {}) {
  const root = baseUrl.replace(/\/+$/, "");

  async function request(method, path, { body, token, timeout = timeoutMs } = {}) {
    const headers = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (token) headers.Authorization = `Bearer ${token}`;
    if (userAgent) headers["User-Agent"] = userAgent;

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    let res;
    try {
      res = await fetchImpl(root + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: ctrl.signal });
    } catch (e) {
      throw new ApiError({ code: ctrl.signal.aborted ? "timeout" : "network", message: ctrl.signal.aborted ? SLOW : OFFLINE });
    } finally {
      clearTimeout(timer);
    }

    if (res.status === 204) return null;
    let data = null;
    try { data = await res.json(); } catch { data = null; }
    if (res.ok) return data;
    const err = (data && data.error) || {};
    throw new ApiError({
      status: res.status,
      code: err.code || "server_error",
      message: err.message || (res.status >= 500 ? "Something went wrong on our side. Try again." : "That didn't work. Try again."),
      fields: err.fields || {},
      retryAfter: err.retryAfter,
    });
  }

  return {
    baseUrl: root,
    health: () => request("GET", "/health"),
    signup: (input) => request("POST", "/v1/auth/signup", { body: input }),
    login: ({ email, password }) => request("POST", "/v1/auth/login", { body: { email, password } }),
    logout: (token) => request("POST", "/v1/auth/logout", { token }),
    logoutAll: (token) => request("POST", "/v1/auth/logout-all", { token }),
    me: (token) => request("GET", "/v1/me", { token }),
    requestReset: (email) => request("POST", "/v1/auth/password-reset", { body: { email } }),
    confirmReset: ({ token, password }) => request("POST", "/v1/auth/password-reset/confirm", { body: { token, password } }),
    updateMe: (token, fields) => request("PATCH", "/v1/me", { token, body: fields }),

    catalog: (token) => request("GET", "/v1/catalog/services", { token }),
    decodeVin: (token, vin) => request("GET", `/v1/vin/${encodeURIComponent(String(vin).trim())}`, { token }),

    vehicles: (token) => request("GET", "/v1/vehicles", { token }),
    vehicle: (token, id) => request("GET", `/v1/vehicles/${encodeURIComponent(id)}`, { token }),
    addVehicle: (token, v) => request("POST", "/v1/vehicles", { token, body: v }),
    updateVehicle: (token, id, v) => request("PATCH", `/v1/vehicles/${encodeURIComponent(id)}`, { token, body: v }),
    removeVehicle: (token, id) => request("DELETE", `/v1/vehicles/${encodeURIComponent(id)}`, { token }),

    places: (token) => request("GET", "/v1/places", { token }),
    addPlace: (token, p) => request("POST", "/v1/places", { token, body: p }),
    updatePlace: (token, id, p) => request("PATCH", `/v1/places/${encodeURIComponent(id)}`, { token, body: p }),
    removePlace: (token, id) => request("DELETE", `/v1/places/${encodeURIComponent(id)}`, { token }),

    pricingSettings: (token) => request("GET", "/v1/pricing/settings", { token }),
    priceMenu: (token, q) => request("GET", `/v1/pricing/menu?${new URLSearchParams(Object.entries(q || {}).filter(([, v]) => v != null && v !== "")).toString()}`, { token }),
    quote: (token, body) => request("POST", "/v1/quotes", { token, body }),

    jobs: (token) => request("GET", "/v1/jobs", { token }),
    job: (token, id) => request("GET", `/v1/jobs/${encodeURIComponent(id)}`, { token }),
    book: (token, body) => request("POST", "/v1/jobs", { token, body }),
    jobBoard: (token) => request("GET", "/v1/jobs/board", { token }),
    offers: (token) => request("GET", "/v1/jobs/offers", { token }),
    messages: (token, id) => request("GET", `/v1/jobs/${encodeURIComponent(id)}/messages`, { token }),
    sendMessage: (token, id, body) => request("POST", `/v1/jobs/${encodeURIComponent(id)}/messages`, { token, body: { body } }),
    jobAction: (token, id, action, body) => request("POST", `/v1/jobs/${encodeURIComponent(id)}/${action}`, { token, body: body || {} }),
    addonDecision: (token, id, addonId, approve) => request("POST", `/v1/jobs/${encodeURIComponent(id)}/addons/${encodeURIComponent(addonId)}/${approve ? "approve" : "decline"}`, { token, body: {} }),

    serviceArea: (token) => request("GET", "/v1/partner/service-area", { token }),
    saveServiceArea: (token, a) => request("PUT", "/v1/partner/service-area", { token, body: a }),
    partnerServices: (token) => request("GET", "/v1/partner/services", { token }),
    savePartnerServices: (token, serviceIds) => request("PUT", "/v1/partner/services", { token, body: { serviceIds } }),

    // Payments (Stripe). Card numbers are typed on Stripe's own page, never in the app.
    paymentsConfig: (token) => request("GET", "/v1/payments/config", { token }),
    cards: (token) => request("GET", "/v1/payments/cards", { token }),
    cardSetup: (token, returnUrl) => request("POST", "/v1/payments/cards/setup", { token, body: { returnUrl } }),
    syncCards: (token) => request("POST", "/v1/payments/cards/sync", { token, body: {} }),
    setDefaultCard: (token, id) => request("POST", `/v1/payments/cards/${encodeURIComponent(id)}/default`, { token, body: {} }),
    removeCard: (token, id) => request("DELETE", `/v1/payments/cards/${encodeURIComponent(id)}`, { token }),
    payJob: (token, id) => request("POST", `/v1/jobs/${encodeURIComponent(id)}/pay`, { token, body: {} }),
    payouts: (token) => request("GET", "/v1/payouts", { token }),
    payoutSetup: (token, returnUrl) => request("POST", "/v1/payouts/account", { token, body: { returnUrl } }),
    syncPayouts: (token) => request("POST", "/v1/payouts/account/sync", { token, body: {} }),
    cashOut: (token) => request("POST", "/v1/payouts/instant", { token, body: {} }),

    // Partner application (onboarding). Tax IDs, bank numbers, and ID photos go to Stripe, never here.
    onboarding: (token) => request("GET", "/v1/onboarding", { token }),
    saveStep: (token, step, body) => request("PUT", `/v1/onboarding/steps/${encodeURIComponent(step)}`, { token, body }),
    onboardingDoc: (token, id) => request("GET", `/v1/onboarding/documents/${encodeURIComponent(id)}`, { token }),
    signDoc: (token, docId, name) => request("POST", "/v1/onboarding/sign", { token, body: { docId, name } }),
    uploadDoc: (token, body) => request("POST", "/v1/onboarding/files", { token, body, timeout: 120_000 }),
    removeDoc: (token, id) => request("DELETE", `/v1/onboarding/files/${encodeURIComponent(id)}`, { token }),
    startIdentity: (token, returnUrl) => request("POST", "/v1/onboarding/identity", { token, body: { returnUrl } }),
    syncIdentity: (token) => request("POST", "/v1/onboarding/identity/sync", { token, body: {} }),
    submitApplication: (token, certify) => request("POST", "/v1/onboarding/submit", { token, body: { certify } }),
    optOutArbitration: (token) => request("POST", "/v1/onboarding/arbitration-opt-out", { token, body: {} }),

    // Photos and proof of work. Photo links from the server are signed, so they open without a sign-in.
    url: (path) => (/^https?:/.test(path) ? path : root + path),
    uploadJobPhoto: (token, id, body) => request("POST", `/v1/jobs/${encodeURIComponent(id)}/photos`, { token, body, timeout: 120_000 }),
    noteDamage: (token, id, slot, note) => request("POST", `/v1/jobs/${encodeURIComponent(id)}/photos/${encodeURIComponent(slot)}/damage`, { token, body: { note } }),
    vehicleHistory: (token, id) => request("GET", `/v1/vehicles/${encodeURIComponent(id)}/history`, { token }),
    incidents: (token) => request("GET", "/v1/incidents", { token }),
    reportIncident: (token, body) => request("POST", "/v1/incidents", { token, body, timeout: 180_000 }),
  };
}

// The server checks everything, but these match its rules so people see problems before they tap the button.
export function passwordHint(password, email = "") {
  if (!password) return "Enter a password.";
  if (password.length < 10) return "Use at least 10 characters.";
  if (password.length > 200) return "Use 200 characters or fewer.";
  if (/^(.)\1+$/.test(password)) return "Don't use the same character over and over.";
  const local = String(email).trim().toLowerCase().split("@")[0];
  if (local.length >= 4 && password.toLowerCase().includes(local)) return "Don't use your email in your password.";
  return null;
}

// Formats a +1XXXXXXXXXX number the way people read it: (865) 555-0100.
export function formatPhone(e164) {
  const d = String(e164 || "").replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : e164 || "";
}

// $12.5 → "$12.50", 1250 cents → "$12.50". Whole dollars drop the cents: "$80".
export function money(cents, { always = false } = {}) {
  if (cents == null) return "";
  const neg = cents < 0;
  const v = Math.abs(cents) / 100;
  const s = !always && Number.isInteger(v) ? v.toLocaleString("en-US") : v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${neg ? "−" : ""}$${s}`;
}
