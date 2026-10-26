# Working in this repo

- Product rules live in `docs/RULES.md`; build order in `docs/ROADMAP.md`. The `prototypes/` HTML files are the source of truth for screens and wording.
- Server: Node 22, ES modules, no framework. Keep dependencies minimal (currently only `pg`).
- SQL must run on both Postgres (production) and SQLite (`node:sqlite`, used for local dev and tests): TEXT ids from `randomUUID()`, BIGINT millisecond timestamps, `$1` placeholders, no Postgres-only syntax. Add schema changes as a new numbered file in `server/migrations/`; never edit an applied one.
- Every endpoint gets tests in `server/test/`. Run `npm test`. CI runs the suite on SQLite and Postgres.
- Never store or log card numbers, bank numbers, SSNs, raw tokens, or passwords. Store tokens hashed.
- User-facing error messages are plain English and say how to fix the problem.
- Phone apps: `apps/customer` and `apps/partner` (Expo SDK 58 to match the current Expo Go, Expo Router with routes in `src/app/`; `/` redirects to `/home` or `/sign-in`). Code both apps use lives in `apps/shared` and is imported by relative path; each app's `metro.config.js` makes that work. Keep `apps/shared/api.js` free of React Native imports so the server tests can run it.
- The prototypes are the look: colors, fonts (Archivo + Manrope), and wording come from `prototypes/customer-app.html` and `prototypes/partner-app.html`. Add app packages with `npx expo install` so versions match the SDK.
- All pricing goes through `server/src/pricing/engine.js` (pure functions, amounts in whole cents). Settings live in `pricing_settings` as numbered versions; never edit a version, publish a new one. Anything priced must record the settings version it used.
