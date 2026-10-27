# Build plan

Each step ships with tests and works end to end before the next one starts.

1. **Accounts** — sign up, sign in, sessions, password reset. ✅
2. **Deploy** — API and Postgres live on Render at https://auto-auto-api.onrender.com, tests running on every push. ✅
3. **Phone app shells** — customer and partner apps (Expo) with real sign-up, sign-in, sign-out, and password reset against the API. ✅
4. **Profiles and vehicles** — customer vehicles (VIN decode), saved places (address private), partner service areas and services offered. ✅ Map coordinates for places and service areas wait on the maps provider; dispatch (step 7) needs them.
5. **Pricing engine** — move the prototype's pricing into the server as one tested module; settings table with versions. ✅ Book times and parts costs are the prototype's samples (`server/src/pricing/rates.js`) until the repair-data license is chosen.
6. **Jobs** — the shared job record and its 11 steps from `prototypes/job-flow.html`, with every rule in `RULES.md`. ✅ Partners use a job board until dispatch (step 7); money is recorded but not charged until payments (step 8); check-in and after photos come with step 10.
7. **Dispatch** — offers to partners, approval windows, widening, no-partner handling, masked messaging. ✅ Google geocoding, one-at-a-time offers, 35-mile widening, in-app chat with numbers hidden. Masked phone calls need a calling provider (not chosen yet); drive times use an estimate until we turn on Google's Routes API.
8. **Payments** — Stripe: saved cards, holds, deposits, charges, partner payouts (Connect), parts cards (Issuing). ✅ Test mode: cards saved on Stripe's page, deposits over $300, estimate holds 24 hours before, final charge at completion, fees and refunds on cancels, partner ledger, weekly/daily/instant payouts with the new-partner reserve. Parts cards (Issuing) wait on Stripe's approval; no webhooks yet (status is checked when people come back from Stripe).
9. **Partner onboarding** — documents, background checks, agreements with e-signatures, Ops Console review. ✅ Ten-step application in the partner app: business & W-9 certification, ID + selfie through Stripe Identity (we keep only the result and 21+), FCRA disclosure and signed authorization, insurance choice with certificate uploads and minimum limits, proof for services that need it, safety standards, payouts, and six agreements with typed-name e-signatures (version and fingerprint recorded). Staff review through the API or `npm run partner-review` until the Ops Console. The background-check vendor isn't chosen yet, so staff record the result; agreements are drafts for attorney review. Jobs pause when required insurance expires.
10. **Photos and proof of work** — check-in/after photos, inspection reports, service history.
11. **Fleet** — accounts, credit approval, multi-vehicle visits, invoices, maintenance logs, DOT reports.
12. **Ops Console** — the staff website from `prototypes/ops-console.html`.
13. **Claims, warranty, ratings, notifications.**
14. **App Store and Google Play release.**
