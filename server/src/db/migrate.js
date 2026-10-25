// Applies SQL files in server/migrations in name order, once each. Safe to run on every deploy.
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../migrations");

export async function migrate(db, { log = () => {} } = {}) {
  await db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at BIGINT NOT NULL)`);
  const done = new Set((await db.all(`SELECT name FROM schema_migrations`)).map((r) => r.name));
  const files = (await readdir(DIR)).filter((f) => f.endsWith(".sql")).sort();
  const applied = [];
  for (const f of files) {
    if (done.has(f)) continue;
    const sql = await readFile(path.join(DIR, f), "utf8");
    await db.tx(async (t) => {
      for (const stmt of splitSql(sql)) await t.exec(stmt);
      await t.run(`INSERT INTO schema_migrations (name, applied_at) VALUES ($1, $2)`, [f, Date.now()]);
    });
    log(`applied ${f}`);
    applied.push(f);
  }
  return applied;
}

// Split on semicolons at line ends. Migrations must not use semicolons inside strings.
function splitSql(sql) {
  return sql
    .split(/;\s*$/m)
    .map((s) => s.replace(/^\s*--.*$/gm, "").trim())
    .filter(Boolean);
}
