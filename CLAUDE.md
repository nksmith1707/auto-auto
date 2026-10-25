# Working in this repo

- Product rules live in `docs/RULES.md`; build order in `docs/ROADMAP.md`. The `prototypes/` HTML files are the source of truth for screens and wording.
- Server: Node 22, ES modules, no framework. Keep dependencies minimal (currently only `pg`).
- SQL must run on both Postgres (production) and SQLite (`node:sqlite`, used for local dev and tests): TEXT ids from `randomUUID()`, BIGINT millisecond timestamps, `$1` placeholders, no Postgres-only syntax. Add schema changes as a new numbered file in `server/migrations/`; never edit an applied one.
- Every endpoint gets tests in `server/test/`. Run `npm test`. CI runs the suite on SQLite and Postgres.
- Never store or log card numbers, bank numbers, SSNs, raw tokens, or passwords. Store tokens hashed.
- User-facing error messages are plain English and say how to fix the problem.
