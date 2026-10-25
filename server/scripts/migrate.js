// npm run migrate: applies any new database migrations. Railway runs this before each deploy.
import { loadConfig } from "../src/config.js";
import { openDb } from "../src/db/index.js";
import { migrate } from "../src/db/migrate.js";

const config = loadConfig();
const db = await openDb(config.databaseUrl, { ssl: config.databaseSsl });
const applied = await migrate(db, { log: (m) => console.log(`[migrate] ${m}`) });
console.log(applied.length ? `[migrate] done, ${applied.length} applied` : "[migrate] already up to date");
await db.close();
