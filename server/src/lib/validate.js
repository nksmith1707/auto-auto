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
    add: fail,
    done() {
      if (Object.keys(errors).length) throw new HttpError(422, "invalid_input", "Some fields need fixing.", { fields: errors });
    },
  };
}
