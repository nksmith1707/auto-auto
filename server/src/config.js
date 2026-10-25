// Reads settings from environment variables. Everything has a safe default for local work.
export function loadConfig(env = process.env) {
  const nodeEnv = env.NODE_ENV || "development";
  const config = {
    nodeEnv,
    isProd: nodeEnv === "production",
    port: Number(env.PORT || 3000),
    // postgres://... in production (Railway sets DATABASE_URL). "sqlite::memory:" or "sqlite:./dev.db" locally.
    databaseUrl: env.DATABASE_URL || "sqlite:./dev.db",
    databaseSsl: env.DATABASE_SSL === "true",
    sessionDays: Number(env.SESSION_DAYS || 30),
    resetMinutes: Number(env.RESET_MINUTES || 30),
    // Comma-separated list of web origins allowed to call the API (the Ops Console). Phone apps don't need this.
    allowedOrigins: (env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean),
    // Trust X-Forwarded-For only behind a known proxy (Railway). Used for rate limiting.
    trustProxy: env.TRUST_PROXY === "true",
    appUrl: env.APP_URL || "http://localhost:3000",
  };
  if (config.isProd && config.databaseUrl.startsWith("sqlite")) {
    throw new Error("DATABASE_URL must point to Postgres in production.");
  }
  return config;
}
