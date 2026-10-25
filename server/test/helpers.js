import { loadConfig } from "../src/config.js";
import { openDb } from "../src/db/index.js";
import { migrate } from "../src/db/migrate.js";
import { createApp } from "../src/app.js";
import { createMailer } from "../src/lib/mailer.js";

// Starts a fresh API on a random port. Uses TEST_DATABASE_URL (Postgres in CI) or an in-memory SQLite database.
export async function startTestApp(env = {}) {
  const config = loadConfig({ NODE_ENV: "test", DATABASE_URL: process.env.TEST_DATABASE_URL || "sqlite::memory:", ALLOWED_ORIGINS: "https://ops.example.com", ...env });
  const db = await openDb(config.databaseUrl);
  if (db.kind === "postgres") {
    // Start clean every run.
    await db.exec("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  }
  await migrate(db);
  const mailer = createMailer({ isProd: false, log: () => {} });
  const { server } = createApp({ db, config, mailer, log: { error: () => {} } });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, { body, token, headers = {}, raw } = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: { ...(body !== undefined || raw !== undefined ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
      body: raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null };
  };
  return {
    db, mailer, call, base,
    async close() { await new Promise((r) => server.close(r)); await db.close(); },
  };
}

export const customer = (over = {}) => ({ role: "customer", email: "jordan@example.com", password: "Correct-Horse-42", firstName: "Jordan", lastName: "Reed", acceptTerms: true, ...over });
export const partner = (over = {}) => ({ role: "partner", email: "amanda@example.com", password: "Wrench-Ready-2026", firstName: "Amanda", lastName: "Smith", phone: "(865) 555-0177", acceptTerms: true, ...over });
