# Build plan

Each step ships with tests and works end to end before the next one starts.

1. **Accounts** — sign up, sign in, sessions, password reset. ✅
2. **Deploy** — API and Postgres live on Render at https://auto-auto-api.onrender.com, tests running on every push. ✅
3. **Phone app shells** — customer and partner apps (Expo) with real sign-up, sign-in, sign-out, and password reset against the API. ✅
4. **Profiles and vehicles** — customer vehicles (VIN decode), saved places (address private), partner service areas and services offered. ✅ Map coordinates for places and service areas wait on the maps provider; dispatch (step 7) needs them.
5. **Pricing engine** — move the prototype's pricing into the server as one tested module; settings table with versions.
6. **Jobs** — the shared job record and its 11 steps from `prototypes/job-flow.html`, with every rule in `RULES.md`.
7. **Dispatch** — offers to partners, approval windows, widening, no-partner handling, masked messaging.
8. **Payments** — Stripe: saved cards, holds, deposits, charges, partner payouts (Connect), parts cards (Issuing).
9. **Partner onboarding** — documents, background checks, agreements with e-signatures, Ops Console review.
10. **Photos and proof of work** — check-in/after photos, inspection reports, service history.
11. **Fleet** — accounts, credit approval, multi-vehicle visits, invoices, maintenance logs, DOT reports.
12. **Ops Console** — the staff website from `prototypes/ops-console.html`.
13. **Claims, warranty, ratings, notifications.**
14. **App Store and Google Play release.**
