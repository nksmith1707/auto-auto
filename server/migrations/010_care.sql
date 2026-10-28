-- Step 13: ratings and tips, damage claims, warranty returns, money partners owe, and notifications.

-- The customer's rating of a finished job. One per job. Reviews show on the partner's profile (first name and last initial).
CREATE TABLE ratings (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
  customer_id TEXT NOT NULL REFERENCES users (id),
  partner_id TEXT NOT NULL REFERENCES users (id),
  stars INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 5),
  tags TEXT NOT NULL DEFAULT '[]',
  service_stars TEXT,
  review TEXT,
  -- Only Auto-Auto staff see this.
  private_note TEXT,
  -- Low ratings get a follow-up from support.
  followed_up_at BIGINT,
  followed_up_by TEXT,
  hidden_at BIGINT,
  hidden_reason TEXT,
  created_at BIGINT NOT NULL
);

CREATE UNIQUE INDEX ratings_job_unique ON ratings (job_id);

CREATE INDEX ratings_partner_idx ON ratings (partner_id, created_at);

-- The partner's private rating of the customer. Never shown to the customer.
CREATE TABLE customer_ratings (
  job_id TEXT PRIMARY KEY REFERENCES jobs (id) ON DELETE CASCADE,
  partner_id TEXT NOT NULL REFERENCES users (id),
  customer_id TEXT NOT NULL REFERENCES users (id),
  stars INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 5),
  created_at BIGINT NOT NULL
);

-- Partners a customer marked as a favorite. Favorites get offered the customer's instant jobs first.
CREATE TABLE favorite_partners (
  customer_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  partner_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (customer_id, partner_id)
);

-- Tips: 100% goes to the partner. Open for 24 hours after the job.
CREATE TABLE tips (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
  customer_id TEXT NOT NULL REFERENCES users (id),
  partner_id TEXT NOT NULL REFERENCES users (id),
  amount_cents INTEGER NOT NULL,
  -- succeeded: charged; recorded: payments are off (local testing); failed: the card was declined.
  status TEXT NOT NULL CHECK (status IN ('succeeded', 'recorded', 'failed')),
  stripe_id TEXT,
  error TEXT,
  created_at BIGINT NOT NULL
);

CREATE INDEX tips_job_idx ON tips (job_id);

-- Damage claims a customer files about a job (RULES.md: Partner Protection, deductible).
CREATE TABLE claims (
  id TEXT PRIMARY KEY,
  number INTEGER NOT NULL,
  job_id TEXT NOT NULL REFERENCES jobs (id),
  customer_id TEXT NOT NULL REFERENCES users (id),
  partner_id TEXT NOT NULL REFERENCES users (id),
  damage_to TEXT NOT NULL CHECK (damage_to IN ('vehicle', 'property', 'other')),
  description TEXT NOT NULL,
  wants TEXT NOT NULL CHECK (wants IN ('repair', 'reimbursement', 'not_sure')),
  estimate_cents INTEGER,
  -- What insurance covered the partner on this job: protection (Auto-Auto Partner Protection), split, or own.
  coverage TEXT,
  -- partner: waiting for the partner's side; review: ready for a decision; closed: decided.
  status TEXT NOT NULL CHECK (status IN ('partner', 'review', 'closed')),
  response_due_at BIGINT NOT NULL,
  partner_response TEXT,
  responded_at BIGINT,
  outcome TEXT CHECK (outcome IN ('pay', 'goodwill', 'deny')),
  amount_cents INTEGER,
  paid_by TEXT,
  decision_note TEXT,
  decided_by TEXT,
  decided_at BIGINT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE UNIQUE INDEX claims_number_unique ON claims (number);

CREATE INDEX claims_job_idx ON claims (job_id);

CREATE INDEX claims_status_idx ON claims (status, created_at);

-- Free return visits under warranty. The new visit is a job with no charge; comeback_of points to the original.
CREATE TABLE warranty_returns (
  id TEXT PRIMARY KEY,
  original_job_id TEXT NOT NULL REFERENCES jobs (id),
  return_job_id TEXT NOT NULL REFERENCES jobs (id),
  customer_id TEXT NOT NULL REFERENCES users (id),
  original_partner_id TEXT NOT NULL REFERENCES users (id),
  issue TEXT NOT NULL,
  details TEXT,
  -- When another partner does the work, the cost is charged back to the original partner unless staff waive it.
  charge_back INTEGER NOT NULL DEFAULT 1,
  created_at BIGINT NOT NULL
);

CREATE INDEX warranty_returns_original_idx ON warranty_returns (original_job_id);

ALTER TABLE jobs ADD COLUMN comeback_of TEXT;

ALTER TABLE jobs ADD COLUMN comeback_partner_id TEXT;

-- Until this time, a warranty return is offered only to the original partner.
ALTER TABLE jobs ADD COLUMN offer_until BIGINT;

-- Claim and warranty photos use the shared photo store.
ALTER TABLE photos ADD COLUMN claim_id TEXT REFERENCES claims (id) ON DELETE CASCADE;

ALTER TABLE photos ADD COLUMN warranty_id TEXT REFERENCES warranty_returns (id) ON DELETE CASCADE;

-- Money a partner owes (claim deductibles, warranty charge-backs). Recovered from payouts, at most 25% of any one.
CREATE TABLE partner_debts (
  id TEXT PRIMARY KEY,
  partner_id TEXT NOT NULL REFERENCES users (id),
  reason TEXT NOT NULL,
  claim_id TEXT REFERENCES claims (id),
  job_id TEXT REFERENCES jobs (id),
  cents INTEGER NOT NULL,
  recovered_cents INTEGER NOT NULL DEFAULT 0,
  waived_at BIGINT,
  waived_by TEXT,
  created_at BIGINT NOT NULL
);

CREATE INDEX partner_debts_partner_idx ON partner_debts (partner_id);

-- In-app notifications. Each can also go out by push, text, or email, depending on the person's settings.
CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  data TEXT,
  -- Stops the same reminder from going out twice.
  dedupe_key TEXT,
  read_at BIGINT,
  created_at BIGINT NOT NULL
);

CREATE INDEX notifications_user_idx ON notifications (user_id, created_at);

CREATE UNIQUE INDEX notifications_dedupe_unique ON notifications (user_id, dedupe_key);

-- Messages waiting to go out by push, text, or email. Sent after the change that caused them is saved.
CREATE TABLE notification_outbox (
  id TEXT PRIMARY KEY,
  notification_id TEXT REFERENCES notifications (id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('push', 'sms', 'email')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_at BIGINT NOT NULL,
  error TEXT,
  created_at BIGINT NOT NULL,
  sent_at BIGINT
);

CREATE INDEX notification_outbox_due_idx ON notification_outbox (status, next_at);

-- Phone alert addresses from Expo (one per phone). Removed when the phone stops accepting them.
CREATE TABLE push_tokens (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  platform TEXT,
  created_at BIGINT NOT NULL,
  last_seen_at BIGINT NOT NULL
);

CREATE INDEX push_tokens_user_idx ON push_tokens (user_id);

-- How each person wants to hear about each kind of update.
CREATE TABLE notification_prefs (
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  push INTEGER NOT NULL,
  sms INTEGER NOT NULL,
  email INTEGER NOT NULL,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (user_id, category)
);

-- Text messages need the person's consent first (they can reply STOP any time).
ALTER TABLE users ADD COLUMN sms_opt_in_at BIGINT;
