// Starts the API. Applies any new database migrations first, so a deploy is just: npm start.
import { loadConfig } from "./config.js";
import { openDb } from "./db/index.js";
import { migrate } from "./db/migrate.js";
import { createApp } from "./app.js";

const config = loadConfig();
const db = await openDb(config.databaseUrl, { ssl: config.databaseSsl });
await migrate(db, { log: (m) => console.log(`[migrate] ${m}`) });

const { server } = createApp({ db, config });
server.listen(config.port, () => console.log(`Auto-Auto API listening on port ${config.port} (${config.nodeEnv})`));

const stop = async () => {
  server.close();
  await db.close();
  process.exit(0);
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
