import { randomBytes, createHash, randomUUID } from "node:crypto";

// Tokens are 32 random bytes, sent to the app once. The database only keeps a SHA-256 hash.
export const newToken = (prefix) => `${prefix}_${randomBytes(32).toString("base64url")}`;
export const hashToken = (token) => createHash("sha256").update(String(token)).digest("hex");
export const newId = () => randomUUID();
