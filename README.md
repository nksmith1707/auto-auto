# Auto-Auto

On-demand mobile auto maintenance for Knoxville, TN. Customers book service at their home, work, or fleet yard; vetted partners (independent mechanics, detailers, glass techs) come to them.

This repo holds the whole system:

| Folder | What it is | Status |
|---|---|---|
| `server/` | The API: accounts, jobs, pricing, payouts. Node 22, Postgres. Live at https://auto-auto-api.onrender.com | Accounts and sign-in done |
| `prototypes/` | Clickable designs of the customer app, partner app, Ops Console, and job flow. Open any `.html` file in a browser. They're the spec for the real screens. | Done |
| `docs/` | Business rules and build plan | Done |
| `apps/customer`, `apps/partner` | Phone apps (Expo / React Native, one codebase for iPhone and Android). `apps/shared` holds the API client and screens both use. | Sign up, log in, log out, password reset |
| `apps/ops` | Ops Console website | Later |

## Run the API on your computer

Needs Node 22 or newer.

```bash
npm install
npm run dev          # starts on http://localhost:3000 with a local SQLite database
npm test             # runs the test suite
```

Check it's up: open http://localhost:3000/health.

Create a staff account for the Ops Console:

```bash
cd server
ADMIN_PASSWORD='a long password' npm run create-admin -- you@company.com First Last
```

## Run the phone apps

The apps are built with Expo SDK 58, which is what the current **Expo Go** app on the App Store and Google Play runs. When Expo Go moves to a new SDK, the apps have to be upgraded to match. Install Expo Go on your phone, then:

```bash
cd apps/customer        # or apps/partner
npm install
npm start               # shows a QR code
```

Scan the QR code with your iPhone camera (or with Expo Go on Android). The app talks to the live API at https://auto-auto-api.onrender.com.

To use a copy of the API running on your computer instead, start it with `npm run dev` in the repo root, then start the app with your computer's local network address (phones can't reach `localhost`):

```bash
EXPO_PUBLIC_API_URL=http://192.168.1.20:3000 npx expo start --clear
```

`--clear` matters whenever you change `EXPO_PUBLIC_API_URL`; otherwise the old address stays cached. Locally the API prints password reset emails to its terminal, so you can copy the code from there.

| App | Screens so far |
|---|---|
| Customer (`apps/customer`) | Splash, Log in / Sign up, Forgot password, Enter reset code, Home (vehicles, places, account), Add/edit vehicle with VIN decode, Prices for each vehicle with a visit estimate, Book a visit (ASAP or a 2-hour window), Your visits, Visit details (approve partner, approve add-ons and glass quotes, reschedule, cancel with fee preview, receipt, inspection report, warranty), Add/edit saved place, Payment cards (add on Stripe's page, choose default, remove), payment status on each visit with Pay now if a card is declined, Edit your details, Log out, Log out on all devices |
| Partner (`apps/partner`) | Splash, Log in, Apply (create partner account), Forgot password, Enter reset code, Application checklist (10 steps: service area, services, business & tax, ID check with Stripe, background check disclosure and authorization, insurance with certificate uploads, experience & certifications, safety standards, payouts, agreements with e-signatures; then review & submit), Service area (home base + travel radius), Services you offer (with pay per job), Open jobs and Your jobs (approved partners), Job screen (accept, start trip, arrive, check in, add-ons, glass quote, inspection, complete, no-show, cancel), Payouts (Stripe setup, balance, activity, instant cash-out), Log out, Log out on all devices |

Notes:
- Sessions are kept in the phone's secure storage (Keychain on iPhone, Keystore on Android), so people stay signed in until they log out or their session expires.
- Each app only accepts its own kind of account. A partner who tries the customer app (or the reverse) is told which app to use.
- **Password reset emails don't go out from the live API yet.** The API makes the code, but no email provider is connected (see "Not decided yet" in `docs/RULES.md`). The reset screens work end to end against a local API.
- The test suite covers the apps' API client against the real server code (`server/test/app-client.test.js`). CI also builds both apps for iPhone, Android, and web on every push.

## Dispatch and maps

With `GOOGLE_MAPS_API_KEY` set on the server (Google Geocoding API), every saved place and partner home base gets a map location. Then:

- "As soon as possible" and roadside requests go to the closest qualified partner first, 30 seconds each, up to 5 partners, then to everyone in range.
- Scheduled requests go on the job board for partners whose service area covers the address.
- Halfway through the request window, the search widens to 35 miles.
- Addresses Google can't find are explained when they're saved. Addresses saved before the key was added are looked up when the server starts.

Without the key (local development), partners see every job for the services they offer. Distances are straight-line miles; drive times are estimated.

## Payments (Stripe)

Set `STRIPE_SECRET_KEY` on the server (Render → the API service → Environment). Never put it in code or chat. `STRIPE_PUBLISHABLE_KEY` is optional (the test-mode key is the default). Without a secret key nothing is charged and booking doesn't need a card; partner earnings are still recorded.

- **Cards:** customers add cards on Stripe's own page (opened from the app). We store only brand, last 4, and expiry. A card is required to book.
- **Deposit:** jobs over $300 are charged the deposit at booking. If it's declined, the booking doesn't go through and the app says why.
- **Hold:** the estimate is held on the card 24 hours before the visit (right away for visits sooner than that, ASAP, and roadside).
- **Final charge:** at completion the hold is captured and anything extra (add-ons) is charged. If a card is declined, the partner is still paid; the customer sees what's due and can pay with another card.
- **Cancels:** holds are released, the fee (if any) is kept, and the rest is refunded. The partner's share of a fee goes to their balance.
- **Payouts:** partners set up a Stripe Express account from the app. Weekly (Mondays 9 PM Eastern) until 10 completed jobs, then daily at 9 PM. New partners have 5% held in reserve until daily payouts unlock. Instant cash-out costs $0.85.
- **Test mode:** use card 4242 4242 4242 4242 with any future date, any CVC, any ZIP. Payouts in test mode need test money in the platform balance first: charge test card 4000 0000 0000 0077 once (its funds are available right away).
- Not yet: parts cards (Stripe Issuing needs approval from Stripe), webhooks (the app checks status when people return from Stripe's pages).

## Partner applications (onboarding)

Partners finish 10 steps in the app, then submit. Each step shows what's still needed.

- **Never stored by Auto-Auto:** SSN/EIN and bank numbers (entered on Stripe's payout page), driver's license numbers, ID photos, and birth dates (Stripe Identity checks the license and a selfie; we keep only "verified" and "21 or older").
- **Stored:** answers, insurance certificates and licenses (PDF or photo, up to 6 MB, private to the partner and staff), and every signature with the typed name, time, IP address, document version, and a SHA-256 fingerprint of the exact text.
- **Background check:** the FCRA disclosure is shown on its own, then the partner signs the authorization. No vendor is chosen yet, so staff record the result.
- **Staff review** (until the Ops Console): `npm run partner-review -- partner@email.com` shows the checklist; add `approve` to approve the documents, record the background check as clear, and approve the partner. `return "what to fix"` sends it back; `deny "reason"` deactivates. Approval is refused until every step is done, the ID is verified as 21+, the background check is clear, and every document is reviewed.
- Stripe Identity must be turned on in the Stripe dashboard (Identity → Get started). In test mode, Stripe's ID page has buttons to pass or fail without a real license.
- Active partners can't take jobs while required insurance is expired; renewing it in the app turns jobs back on.
- Agreement text lives in `server/src/onboarding/documents.js`. Changing any text means raising its version number; partners then sign the new version.

## Deploy on Render

`render.yaml` sets up everything: the API service and a Postgres database (about $13/month on the Starter and Basic-256mb plans).

1. Sign in at render.com with your GitHub account.
2. Click **New → Blueprint**, pick the `auto-auto` repo, and click **Apply**.
3. Wait for the first deploy to finish, then open the service's `.onrender.com` address followed by `/health`. You should see `{"ok":true}`.
4. Every push to `main` redeploys. Database changes apply automatically when the server starts.

The API runs anywhere that has Node 22 and Postgres. To use another host, set `DATABASE_URL`, `NODE_ENV=production`, and `TRUST_PROXY=true`, and run `npm install` then `npm start`.

## API so far

All requests and responses are JSON. Signed-in requests send `Authorization: Bearer <token>`.

| Method | Path | What it does |
|---|---|---|
| GET | `/health` | Server and database are up |
| POST | `/v1/auth/signup` | Create a customer or partner account. Body: `role`, `email`, `password`, `firstName`, `lastName`, `phone` (required for partners), `acceptTerms: true` |
| POST | `/v1/auth/login` | Sign in. Body: `email`, `password` |
| POST | `/v1/auth/logout` | Sign out this device |
| POST | `/v1/auth/logout-all` | Sign out every device |
| GET | `/v1/me` | The signed-in account (partners include their application status) |
| POST | `/v1/auth/password-reset` | Email a reset code. Same answer whether or not the account exists |
| POST | `/v1/auth/password-reset/confirm` | Body: `token`, `password`. Signs out all devices |
| PATCH | `/v1/me` | Change `firstName`, `lastName`, `phone` (partners must keep a phone). Email changes go through support |
| GET | `/v1/catalog/services` | Services partners can offer, by category. `needsProof` marks brake work, glass, DOT, and washing |
| GET | `/v1/vin/:vin` | Customers. Checks the VIN (length, letters, check digit), reads the model year and maker, and looks up model, trim, engine, and fuel from NHTSA when it can (cached) |
| GET, POST | `/v1/vehicles` | Customers. List or add vehicles (up to 10). Body: `year`, `make`, `model`, plus optional `trim`, `vin`, `plate`, `plateState`, `color`, `mileage`, `fuel`, `oilPreference`, `nickname`, `insurer`, `policyNumber` |
| GET, PATCH, DELETE | `/v1/vehicles/:id` | Customers, own vehicles only. Removing archives the vehicle so its history stays |
| GET, POST | `/v1/places` | Customers. Saved places (up to 10): `label`, `street`, `unit`, `city`, `state`, `zip`, `parking`, `notes`, `isDefault`. The first place is the default |
| PATCH, DELETE | `/v1/places/:id` | Customers, own places only. Removing the default hands it to the next place |
| GET, PUT | `/v1/partner/service-area` | Partners. Home base address (private) and travel radius, 5 to 60 miles in steps of 5 |
| GET, PUT | `/v1/partner/services` | Partners. Body: `serviceIds` from the catalog |
| GET | `/v1/payments/config` | Whether payments are on, and the publishable key |
| GET | `/v1/payments/cards` | Customers. Saved cards (brand, last 4, expiry, default) |
| POST | `/v1/payments/cards/setup` | Customers. Body: `returnUrl` (the app's link). Returns Stripe's card page `url` |
| POST | `/v1/payments/cards/sync` | Customers. Pulls in cards added on Stripe's page |
| POST | `/v1/payments/cards/:id/default` | Customers. Use this card for payments (retries anything that was declined) |
| DELETE | `/v1/payments/cards/:id` | Customers. Can't remove the only card while a visit is coming up |
| POST | `/v1/jobs/:id/pay` | Customers. Try again to pay what's due after a declined card |
| GET | `/v1/onboarding` | Partners. The application: every step with what's still needed, answers, documents, signatures, ID and background status |
| PUT | `/v1/onboarding/steps/:step` | Partners. Save answers for `business`, `identity`, `background`, `insurance`, `skills`, `safety`, or `payouts` |
| GET | `/v1/onboarding/documents/:id` | The text of an agreement or disclosure, with its version |
| POST | `/v1/onboarding/sign` | Partners. Body: `docId`, `name` (must match the legal name). Consent and disclosure need no name |
| POST | `/v1/onboarding/files` | Partners. Body: `kind`, `filename`, `contentType` (PDF, JPG, PNG, HEIC), `data` (base64, up to 6 MB) |
| GET, DELETE | `/v1/onboarding/files/:id` | Partners. Download or remove their own upload |
| POST | `/v1/onboarding/identity` | Partners. Body: `returnUrl`. Returns Stripe's ID check `url` |
| POST | `/v1/onboarding/identity/sync` | Partners. Picks up the ID check result |
| POST | `/v1/onboarding/submit` | Partners. Body: `certify: true`. Every step must be done |
| POST | `/v1/onboarding/arbitration-opt-out` | Partners. Within 30 days of signing the arbitration agreement |
| GET | `/v1/admin/applications` | Staff. Applications, submitted first |
| GET | `/v1/admin/applications/:id` | Staff. One application, including where each signature came from |
| GET | `/v1/admin/documents/:id/file` | Staff. Download an upload |
| POST | `/v1/admin/documents/:id/review` | Staff. Body: `status` (approved/rejected), `note` (required to reject) |
| POST | `/v1/admin/applications/:id/background` | Staff. Body: `status` (pending/clear/consider/adverse), `note` |
| POST | `/v1/admin/applications/:id/identity` | Staff. Verify ID by hand. Body: `status`, `over21` |
| POST | `/v1/admin/applications/:id/decision` | Staff. Body: `decision` (approve/return/deny), `note` |
| GET | `/v1/payouts` | Partners. Balance, reserve, schedule, payouts, and activity |
| POST | `/v1/payouts/account` | Partners. Body: `returnUrl`. Returns Stripe's payout setup `url` |
| POST | `/v1/payouts/account/sync` | Partners. Checks whether payout setup is finished |
| POST | `/v1/payouts/instant` | Partners. Cash out the balance now ($0.85 fee) |
| GET | `/pay/return` | Where Stripe's pages send people back; redirects into the app |
| GET | `/v1/pricing/settings` | The live Pricing & rules version: every number RULES.md marks *setting*, with labels and limits |
| GET | `/v1/pricing/settings/history` | Admins. Every version with its note and what changed |
| POST | `/v1/pricing/settings` | Admins. Publish a new version. Body: `changes` (e.g. `{ "labor": 110 }`), `note` (required), `expectedVersion` |
| GET | `/v1/pricing/menu` | Every service priced for a vehicle (`vehicleId` for customers, `make`/`model` for partners). Partners also see what they'd earn |
| POST | `/v1/quotes` | A visit: `serviceIds` plus the vehicle. Returns lines, fees, total, deposit, card hold, and (partners/admins) partner pay |
| POST | `/v1/quotes/glass` | Partners. Glass replacement price from `glassCost`, `serviceId`, `needsCalibration` |

| GET | `/v1/jobs` | Your jobs (customers: bookings; partners: jobs you took) |
| POST | `/v1/jobs` | Customers book: `vehicleId`, `placeId`, `serviceIds`, `kind` (`scheduled`, `asap`, `roadside`), `windowStart` for scheduled, `approvePartner`, `notes`. Price is locked with the settings version |
| GET | `/v1/jobs/:id` | One job. Customers see their partner, add-ons, cancel fee preview, receipt. Partners see the area until Start trip, then the address |
| GET | `/v1/jobs/board` | Approved partners: open jobs for services they offer |
| POST | `/v1/jobs/:id/accept`, `start-trip`, `arrive`, `check-in`, `addons`, `glass-quote`, `complete`, `no-show` | Partner steps (`check-in` needs `odometer`; `complete` needs the 8-item `inspection`) |
| POST | `/v1/jobs/:id/approve-partner`, `decline-partner`, `addons/:addonId/approve`, `addons/:addonId/decline`, `reschedule`, `switch-partner` | Customer steps |
| POST | `/v1/jobs/:id/cancel` | Customer or partner. Applies the cancellation rules; send `expectedFeeCents` to confirm the fee you showed |
| GET | `/v1/jobs/offers` | Partners: job offers waiting for you (30 seconds each) |
| POST | `/v1/jobs/:id/decline-offer` | Partners: pass on an offer; it goes to the next closest partner right away |
| GET, POST | `/v1/jobs/:id/messages` | Customer and their partner: in-app chat (`body`). Phone numbers and emails are hidden |
| GET | `/v1/admin/partners` | Staff: partners with status and review flags |
| POST | `/v1/admin/partners/:id/status` | Staff: `status` (`active` approves), `reason` (required to pause) |

Approve a partner from the command line (until the Ops Console has a button): `npm run partner-status -- partner@email.com active` in the server folder, or in the Render shell.

Money in every response is in whole cents (`priceCents: 8000` is $80.00). Each quote says which settings version it used.

Errors look like `{ "error": { "code": "invalid_input", "message": "...", "fields": { "email": "..." } } }`.

## Security choices

- Passwords are hashed with scrypt. Sign-in tokens and reset codes are stored only as SHA-256 hashes.
- Wrong password and unknown email get the same answer, and reset requests never reveal whether an account exists.
- Sign-in is rate limited per email and per IP. Sign-ups and reset requests are limited per IP.
- Staff (admin) accounts can only be created from the command line, never through the public API.
- No card or bank numbers ever touch this server. Payments and payouts will go through Stripe.
