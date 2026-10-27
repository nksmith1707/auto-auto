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
    // Look up VIN details (model, trim, engine) from NHTSA's free vPIC service. Off in tests; set VIN_LOOKUP=off to disable.
    // Google Maps key for turning addresses into map locations (dispatch). Without it, partners see every job for their services.
    googleMapsKey: env.GOOGLE_MAPS_API_KEY || null,
    // Only changed for local testing against a stand-in.
    googleMapsBaseUrl: env.GOOGLE_MAPS_BASE_URL || "https://maps.googleapis.com",
    // Stripe (step 8). The secret key lives only in Render's environment settings. Without it, nothing is charged.
    stripeSecretKey: env.STRIPE_SECRET_KEY || null,
    // The publishable key is safe to share (it can only start card forms). Test-mode key by default.
    stripePublishableKey: env.STRIPE_PUBLISHABLE_KEY || "pk_test_51UUrPKCxf663Da6TZrQjyahzOvMBcowpM7AwRXs4uOqf5XaMLw8v57qLPAOYQMRCZvDX3yrjzV4WFwtGV4NDLKyJ00QkdEYXFD",
    // Only changed for local testing against a stand-in.
    stripeBaseUrl: env.STRIPE_BASE_URL || "https://api.stripe.com",
    // This server's public address, for links back from Stripe's pages. Render sets RENDER_EXTERNAL_URL itself.
    publicUrl: env.PUBLIC_URL || env.RENDER_EXTERNAL_URL || null,
    vinLookup: env.VIN_LOOKUP ? env.VIN_LOOKUP !== "off" : nodeEnv !== "test",
  };
  if (config.isProd && config.databaseUrl.startsWith("sqlite")) {
    throw new Error("DATABASE_URL must point to Postgres in production.");
  }
  return config;
}
