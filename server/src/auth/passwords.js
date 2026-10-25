// Password hashing with scrypt (built into Node). Stored as: scrypt$N$r$p$saltBase64$hashBase64
import { scrypt as scryptCb, randomBytes, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb);
const N = 2 ** 15, R = 8, P = 1, KEYLEN = 64;
const MAXMEM = 128 * N * R * 2;

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scrypt(password.normalize("NFKC"), salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM });
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password, stored) {
  const parts = String(stored || "").split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, saltB64, hashB64] = parts;
  const expected = Buffer.from(hashB64, "base64");
  const key = await scrypt(password.normalize("NFKC"), Buffer.from(saltB64, "base64"), expected.length, {
    N: Number(n), r: Number(r), p: Number(p), maxmem: 128 * Number(n) * Number(r) * 2,
  });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

// A hash of a random password, so failed sign-ins for unknown emails take the same time as real ones.
let dummyHash;
export async function dummyVerify(password) {
  dummyHash ||= await hashPassword(randomBytes(12).toString("hex"));
  await verifyPassword(password, dummyHash);
  return false;
}

const COMMON = new Set(["password", "password1", "password123", "1234567890", "12345678910", "qwertyuiop", "letmein123", "iloveyou12", "welcome123", "autoauto123", "abc1234567", "qwerty1234"]);

// Returns an error message, or null if the password is acceptable.
export function passwordProblem(password, { email = "" } = {}) {
  if (typeof password !== "string") return "Enter a password.";
  if (password.length < 10) return "Use at least 10 characters.";
  if (password.length > 200) return "Use 200 characters or fewer.";
  if (/^(.)\1+$/.test(password)) return "Don't use the same character over and over.";
  if (COMMON.has(password.toLowerCase())) return "That password is too common. Pick something harder to guess.";
  const local = email.split("@")[0].toLowerCase();
  if (local.length >= 4 && password.toLowerCase().includes(local)) return "Don't use your email in your password.";
  return null;
}
