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

  async function request(method, path, { body, token } = {}) {
    const headers = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (token) headers.Authorization = `Bearer ${token}`;
    if (userAgent) headers["User-Agent"] = userAgent;

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
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
