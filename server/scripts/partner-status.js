// Changes a partner's status (approve them so they can take jobs, pause, etc.) until the Ops Console has a button for it.
// Usage: npm run partner-status -- partner@email.com active
import { loadConfig } from "../src/config.js";
import { openDb } from "../src/db/index.js";
import { migrate } from "../src/db/migrate.js";

const [email, status, ...why] = process.argv.slice(2);
const allowed = ["applicant", "in_review", "active", "paused", "deactivated"];
if (!email || !allowed.includes(status)) {
  console.error(`Usage: npm run partner-status -- partner@email.com <${allowed.join("|")}> [reason]`);
  process.exit(1);
}
const config = loadConfig();
const db = await openDb(config.databaseUrl, { ssl: config.databaseSsl });
await migrate(db);
try {
  const u = await db.get(`SELECT id FROM users WHERE email = $1 AND role = 'partner'`, [email.trim().toLowerCase()]);
  if (!u) throw new Error(`No partner account with the email ${email}.`);
  await db.run(`UPDATE partner_profiles SET status = $1, status_reason = $2, updated_at = $3 WHERE user_id = $4`, [status, why.join(" ") || null, Date.now(), u.id]);
  console.log(`${email} is now ${status}.`);
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
} finally {
  await db.close();
}
