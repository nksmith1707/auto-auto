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
    // Check-in and after photos are required on every job. Tests that aren't about photos turn this off.
    requireJobPhotos: env.REQUIRE_JOB_PHOTOS !== "off",
    // Signs photo links. Set it so links keep working across restarts; without it a random one is made at start.
    photoSecret: env.PHOTO_URL_SECRET || null,
    vinLookup: env.VIN_LOOKUP ? env.VIN_LOOKUP !== "off" : nodeEnv !== "test",
    // Notifications (step 13). Texts go through Twilio; email through Resend or Postmark (whichever key is set).
    // Without keys, nothing is sent: messages still show in the app's inbox, and the server log says what would have gone out.
    twilio: {
      accountSid: env.TWILIO_ACCOUNT_SID || null,
      authToken: env.TWILIO_AUTH_TOKEN || null,
      from: env.TWILIO_FROM_NUMBER || null,
      messagingServiceSid: env.TWILIO_MESSAGING_SERVICE_SID || null,
      baseUrl: env.TWILIO_BASE_URL || "https://api.twilio.com",
    },
    email: {
      resendKey: env.RESEND_API_KEY || null,
      postmarkToken: env.POSTMARK_SERVER_TOKEN || null,
      // Who emails come from, like "Auto-Auto <hello@yourdomain.com>". The domain must be verified with the provider.
      from: env.EMAIL_FROM || null,
      resendBaseUrl: env.RESEND_BASE_URL || "https://api.resend.com",
      postmarkBaseUrl: env.POSTMARK_BASE_URL || "https://api.postmarkapp.com",
    },
    // Phone alerts through Expo's push service. No key needed; EXPO_ACCESS_TOKEN only if push security is turned on.
    push: { baseUrl: env.EXPO_PUSH_URL || "https://exp.host", accessToken: env.EXPO_ACCESS_TOKEN || null, on: env.PUSH !== "off" },
  };
  if (config.isProd && config.databaseUrl.startsWith("sqlite")) {
    throw new Error("DATABASE_URL must point to Postgres in production.");
  }
  return config;
}
