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

The apps are built with Expo SDK 57, which is what the current **Expo Go** app on the App Store and Google Play runs. Install Expo Go on your phone, then:

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
| Customer (`apps/customer`) | Splash, Log in / Sign up, Forgot password, Enter reset code, Home with account details, Log out, Log out on all devices |
| Partner (`apps/partner`) | Splash, Log in, Apply (create partner account), Forgot password, Enter reset code, Application status, Log out, Log out on all devices |

Notes:
- Sessions are kept in the phone's secure storage (Keychain on iPhone, Keystore on Android), so people stay signed in until they log out or their session expires.
- Each app only accepts its own kind of account. A partner who tries the customer app (or the reverse) is told which app to use.
- **Password reset emails don't go out from the live API yet.** The API makes the code, but no email provider is connected (see "Not decided yet" in `docs/RULES.md`). The reset screens work end to end against a local API.
- The test suite covers the apps' API client against the real server code (`server/test/app-client.test.js`). CI also builds both apps for iPhone, Android, and web on every push.

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

Errors look like `{ "error": { "code": "invalid_input", "message": "...", "fields": { "email": "..." } } }`.

## Security choices

- Passwords are hashed with scrypt. Sign-in tokens and reset codes are stored only as SHA-256 hashes.
- Wrong password and unknown email get the same answer, and reset requests never reveal whether an account exists.
- Sign-in is rate limited per email and per IP. Sign-ups and reset requests are limited per IP.
- Staff (admin) accounts can only be created from the command line, never through the public API.
- No card or bank numbers ever touch this server. Payments and payouts will go through Stripe.
