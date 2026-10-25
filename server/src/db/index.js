// One small database interface for two engines:
//   - Postgres (production, via the "pg" package)
//   - SQLite (local development and tests, built into Node 22 as node:sqlite)
// Queries use Postgres-style $1, $2 placeholders. Keep SQL portable: TEXT ids, BIGINT millisecond timestamps.

export async function openDb(url, { ssl = false } = {}) {
  if (url.startsWith("postgres://") || url.startsWith("postgresql://")) return openPostgres(url, ssl);
  if (url.startsWith("sqlite:")) return openSqlite(url.slice("sqlite:".length));
  throw new Error(`Unsupported DATABASE_URL: ${url.split(":")[0]}`);
}

async function openPostgres(url, ssl) {
  const { default: pg } = await import("pg");
  // Return BIGINT columns as numbers (our timestamps are milliseconds, well inside safe range).
  pg.types.setTypeParser(20, (v) => Number(v));
  const pool = new pg.Pool({ connectionString: url, ssl: ssl ? { rejectUnauthorized: false } : undefined, max: 10 });
  const wrap = (client) => ({
    kind: "postgres",
    async all(sql, params = []) { return (await client.query(sql, params)).rows; },
    async get(sql, params = []) { return (await client.query(sql, params)).rows[0] || null; },
    async run(sql, params = []) { const r = await client.query(sql, params); return { changes: r.rowCount }; },
    async exec(sql) { await client.query(sql); },
  });
  const db = wrap(pool);
  db.tx = async (fn) => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const out = await fn(wrap(client));
      await client.query("COMMIT");
      return out;
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  };
  db.close = () => pool.end();
  return db;
}

async function openSqlite(path) {
  const { DatabaseSync } = await import("node:sqlite");
  const sqlite = new DatabaseSync(path === ":memory:" || path === "" ? ":memory:" : path);
  sqlite.exec("PRAGMA foreign_keys = ON;");
  // $1 -> ?1 (SQLite numbered parameters)
  const conv = (sql) => sql.replace(/\$(\d+)/g, "?$1");
  const norm = (row) => (row ? { ...row } : null);
  const db = {
    kind: "sqlite",
    async all(sql, params = []) { return sqlite.prepare(conv(sql)).all(...params).map(norm); },
    async get(sql, params = []) { return norm(sqlite.prepare(conv(sql)).get(...params)); },
    async run(sql, params = []) { const r = sqlite.prepare(conv(sql)).run(...params); return { changes: Number(r.changes) }; },
    async exec(sql) { sqlite.exec(sql); },
  };
  let depth = 0;
  db.tx = async (fn) => {
    // SQLite has one connection, so nested calls just join the outer transaction.
    if (depth++ > 0) { try { return await fn(db); } finally { depth--; } }
    sqlite.exec("BEGIN");
    try {
      const out = await fn(db);
      sqlite.exec("COMMIT");
      return out;
    } catch (e) {
      sqlite.exec("ROLLBACK");
      throw e;
    } finally {
      depth--;
    }
  };
  db.close = async () => sqlite.close();
  return db;
}
