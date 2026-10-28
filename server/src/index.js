// Starts the API. Applies any new database migrations first, so a deploy is just: npm start.
import { loadConfig } from "./config.js";
import { openDb } from "./db/index.js";
import { migrate } from "./db/migrate.js";
import { createApp } from "./app.js";

const config = loadConfig();
const db = await openDb(config.databaseUrl, { ssl: config.databaseSsl });

// On a fresh deploy the database can take a minute to accept connections. Wait for it instead of crashing.
for (let attempt = 1; ; attempt++) {
  try {
    await db.get("SELECT 1 AS ok");
    break;
  } catch (e) {
    if (attempt >= 24) throw e;
    console.log(`[db] not reachable yet (${e.code || e.message}); retrying in 5s (${attempt}/24)`);
    await new Promise((r) => setTimeout(r, 5000));
  }
}
await migrate(db, { log: (m) => console.log(`[migrate] ${m}`) });

const { server, jobs, notify, tick } = createApp({ db, config });
// Every 5 seconds: move offers along (30 seconds each), widen searches, close requests nobody took, approvals that ran out,
// claims past their response time, reminders, and send waiting notifications.
jobs.backfillLocations((m) => console.log(m)).catch((e) => console.error("[maps] backfill failed", e));
setInterval(() => tick().catch((e) => console.error("[sweep] failed", e)), 5_000).unref();
const p = notify.providers();
console.log(`[notify] phone alerts: ${p.push ? "on" : "off"} · texts: ${p.sms || "not connected"} · email: ${p.email || "not connected"}`);
server.listen(config.port, () => console.log(`Auto-Auto API listening on port ${config.port} (${config.nodeEnv})`));

const stop = async () => {
  server.close();
  await db.close();
  process.exit(0);
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
