-- Step 8: payments. Cards are saved on Stripe; we keep only the brand, last four digits, and expiry to show in the app.

CREATE TABLE stripe_customers (
  user_id TEXT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  stripe_customer_id TEXT NOT NULL,
  created_at BIGINT NOT NULL
);

CREATE TABLE cards (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  brand TEXT NOT NULL,
  last4 TEXT NOT NULL,
  exp_month INTEGER NOT NULL,
  exp_year INTEGER NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL
);

CREATE INDEX cards_user_idx ON cards (user_id);

-- Every money movement on a job: deposit, hold, charge, fee, refund.
CREATE TABLE payments (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users (id),
  kind TEXT NOT NULL CHECK (kind IN ('deposit', 'hold', 'charge', 'fee', 'refund')),
  stripe_id TEXT,
  card_id TEXT,
  amount_cents INTEGER NOT NULL,
  captured_cents INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('succeeded', 'held', 'captured', 'released', 'failed')),
  error TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE INDEX payments_job_idx ON payments (job_id);

-- What each job still owes after completion when a charge failed (Auto-Auto collects; the partner is paid anyway).
ALTER TABLE jobs ADD COLUMN payment_status TEXT;

-- Partner money: earnings, parts reimbursements, fee shares, reserve, and payouts. Balance = sum of cents.
CREATE TABLE partner_ledger (
  id TEXT PRIMARY KEY,
  partner_id TEXT NOT NULL REFERENCES users (id),
  job_id TEXT REFERENCES jobs (id),
  payout_id TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('earnings', 'parts', 'fee_share', 'reserve', 'reserve_release', 'payout', 'cashout_fee', 'adjustment')),
  cents INTEGER NOT NULL,
  note TEXT,
  created_at BIGINT NOT NULL
);

CREATE INDEX partner_ledger_partner_idx ON partner_ledger (partner_id, created_at);

CREATE TABLE payout_accounts (
  user_id TEXT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  stripe_account_id TEXT NOT NULL,
  payouts_enabled INTEGER NOT NULL DEFAULT 0,
  details_submitted INTEGER NOT NULL DEFAULT 0,
  updated_at BIGINT NOT NULL
);

CREATE TABLE payouts (
  id TEXT PRIMARY KEY,
  partner_id TEXT NOT NULL REFERENCES users (id),
  kind TEXT NOT NULL CHECK (kind IN ('daily', 'weekly', 'instant')),
  amount_cents INTEGER NOT NULL,
  fee_cents INTEGER NOT NULL DEFAULT 0,
  stripe_transfer_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('paid', 'failed')),
  error TEXT,
  created_at BIGINT NOT NULL
);

CREATE INDEX payouts_partner_idx ON payouts (partner_id, created_at);

-- One row per scheduled run so a batch never runs twice.
CREATE TABLE payout_runs (
  id TEXT PRIMARY KEY,
  created_at BIGINT NOT NULL
);
