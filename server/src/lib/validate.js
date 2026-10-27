// Small input checks. Each returns a cleaned value or adds a field error.
import { HttpError } from "./http.js";

export function checker() {
  const errors = {};
  const fail = (f, m) => { if (!errors[f]) errors[f] = m; };
  return {
    errors,
    email(f, v) {
      const s = typeof v === "string" ? v.trim().toLowerCase() : "";
      if (!s) return fail(f, "Enter your email."), s;
      if (s.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s)) fail(f, "Enter a valid email address.");
      return s;
    },
    name(f, v, label) {
      const s = typeof v === "string" ? v.trim().replace(/\s+/g, " ") : "";
      if (!s) fail(f, `Enter your ${label}.`);
      else if (s.length > 60) fail(f, `Keep your ${label} under 60 characters.`);
      else if (/[<>{}\[\]\\]/.test(s)) fail(f, `Use only letters, spaces, and punctuation in your ${label}.`);
      return s;
    },
    // US phone numbers, stored as +1XXXXXXXXXX.
    phone(f, v, { required = false } = {}) {
      if (v == null || v === "") { if (required) fail(f, "Enter your mobile number."); return null; }
      const d = String(v).replace(/\D/g, "");
      const ten = d.length === 11 && d[0] === "1" ? d.slice(1) : d;
      if (ten.length !== 10 || /^[01]/.test(ten)) { fail(f, "Enter a 10-digit US mobile number."); return null; }
      return `+1${ten}`;
    },
    oneOf(f, v, allowed, msg) {
      if (!allowed.includes(v)) fail(f, msg);
      return v;
    },
    string(f, v, { max = 500, required = true, msg } = {}) {
      const s = typeof v === "string" ? v.trim() : "";
      if (required && !s) fail(f, msg || "This is required.");
      if (s.length > max) fail(f, `Keep this under ${max} characters.`);
      return s;
    },
    // Optional short text. Returns null when empty.
    text(f, v, { max = 60, label = "this", required = false } = {}) {
      if (v == null || (typeof v === "string" && !v.trim())) { if (required) fail(f, `Enter ${label}.`); return null; }
      if (typeof v !== "string") { fail(f, `Enter ${label} as text.`); return null; }
      const s = v.trim().replace(/\s+/g, " ");
      if (s.length > max) fail(f, `Keep ${label} under ${max} characters.`);
      else if (/[<>{}\\]/.test(s)) fail(f, `Use only letters, numbers, and punctuation in ${label}.`);
      return s;
    },
    int(f, v, { min, max, label = "this", required = false } = {}) {
      if (v == null || v === "") { if (required) fail(f, `Enter ${label}.`); return null; }
      const n = typeof v === "number" ? v : Number(String(v).replace(/[,\s]/g, ""));
      if (!Number.isInteger(n)) { fail(f, `Enter ${label} as a whole number.`); return null; }
      if (n < min || n > max) { fail(f, `Enter ${label} between ${min.toLocaleString("en-US")} and ${max.toLocaleString("en-US")}.`); return null; }
      return n;
    },
    usState(f, v, { required = true } = {}) {
      const s = typeof v === "string" ? v.trim().toUpperCase() : "";
      if (!s) { if (required) fail(f, "Choose a state."); return null; }
      if (!US_STATES.has(s)) { fail(f, "Use the 2-letter state code, like TN."); return null; }
      return s;
    },
    zip(f, v) {
      const s = typeof v === "string" || typeof v === "number" ? String(v).trim() : "";
      if (!s) { fail(f, "Enter the ZIP code."); return null; }
      if (!/^\d{5}(-\d{4})?$/.test(s)) { fail(f, "Enter a 5-digit ZIP code."); return null; }
      return s.slice(0, 5);
    },
    add: fail,
    done() {
      if (Object.keys(errors).length) throw new HttpError(422, "invalid_input", "Some fields need fixing.", { fields: errors });
    },
  };
}

export const US_STATES = new Set("AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split(" "));
