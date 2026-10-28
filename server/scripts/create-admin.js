// Creates an Auto-Auto staff account for the Ops Console. Admins can't sign up through the app.
// Usage: ADMIN_PASSWORD='...' npm run create-admin -- you@company.com First Last
import { loadConfig } from "../src/config.js";
import { openDb } from "../src/db/index.js";
import { migrate } from "../src/db/migrate.js";
import { createAuth } from "../src/auth/service.js";
import { createMailer } from "../src/lib/mailer.js";

const [email, firstName = "Admin", lastName = "User"] = process.argv.slice(2);
const password = process.env.ADMIN_PASSWORD;
if (!email || !password) {
  console.error("Usage: ADMIN_PASSWORD='a long password' npm run create-admin -- you@company.com First Last");
  process.exit(1);
}
const config = loadConfig();
const db = await openDb(config.databaseUrl, { ssl: config.databaseSsl });
await migrate(db);
const auth = createAuth({ db, config, mailer: createMailer({ isProd: config.isProd }) });
try {
  const existing = await db.get(`SELECT id, role FROM users WHERE email = $1`, [email.trim().toLowerCase()]);
  if (existing && existing.role !== "admin") throw new Error(`${email} is already a ${existing.role} account. Use a different email for staff.`);
  if (existing) {
    // Running it again for an existing staff account sets a new password (there's no reset email for staff yet).
    const { hashPassword, passwordProblem } = await import("../src/auth/passwords.js");
    const problem = passwordProblem(password, { email });
    if (problem) throw new Error(problem);
    await db.run(`UPDATE users SET password_hash = $1, updated_at = $2 WHERE id = $3`, [await hashPassword(password), Date.now(), existing.id]);
    await db.run(`DELETE FROM sessions WHERE user_id = $1`, [existing.id]);
    console.log(`New password set for ${email}. Sign in at /ops.`);
  } else {
    await auth.createAdmin({ email, password, firstName, lastName });
    console.log(`Admin account created for ${email}. Sign in at /ops.`);
  }
} catch (e) {
  console.error(`Couldn't create admin: ${e.message}`);
  process.exitCode = 1;
} finally {
  await db.close();
}
