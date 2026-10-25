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
  await auth.createAdmin({ email, password, firstName, lastName });
  console.log(`Admin account created for ${email}`);
} catch (e) {
  console.error(`Couldn't create admin: ${e.message}`);
  process.exitCode = 1;
} finally {
  await db.close();
}
