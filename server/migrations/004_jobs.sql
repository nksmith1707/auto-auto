-- Step 6: the shared job record (prototypes/job-flow.html) used by the customer app, partner app, and Ops Console.
-- Status moves forward through: requested → awaiting_approval → confirmed → en_route → arrived → in_progress → completed.
-- Or ends early: cancelled, expired. Every change is also written to job_events.

CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES users (id),
  partner_id TEXT REFERENCES users (id),
  vehicle_id TEXT NOT NULL REFERENCES vehicles (id),
  place_id TEXT NOT NULL REFERENCES places (id),
  kind TEXT NOT NULL CHECK (kind IN ('scheduled', 'asap', 'roadside')),
  status TEXT NOT NULL CHECK (status IN ('requested', 'awaiting_approval', 'confirmed', 'en_route', 'arrived', 'in_progress', 'completed', 'cancelled', 'expired')),
  service_ids TEXT NOT NULL,
  -- Price locked at booking with the settings version it used, so later rate changes don't touch it.
  settings_version INTEGER NOT NULL,
  quote TEXT NOT NULL,
  notes TEXT,
  window_start BIGINT NOT NULL,
  window_end BIGINT NOT NULL,
  request_expires_at BIGINT NOT NULL,
  approve_partner INTEGER NOT NULL DEFAULT 0,
  approval_deadline BIGINT,
  reschedule_count INTEGER NOT NULL DEFAULT 0,
  -- Partners who declined, cancelled, or weren't approved don't get this job again.
  excluded_partners TEXT NOT NULL DEFAULT '[]',
  priority INTEGER NOT NULL DEFAULT 0,
  accepted_at BIGINT,
  confirmed_at BIGINT,
  trip_started_at BIGINT,
  arrived_at BIGINT,
  odometer_in INTEGER,
  work_started_at BIGINT,
  inspection TEXT,
  work_notes TEXT,
  completed_at BIGINT,
  final TEXT,
  warranty_until BIGINT,
  warranty_miles_until INTEGER,
  cancelled_at BIGINT,
  cancelled_by TEXT CHECK (cancelled_by IN ('customer', 'partner', 'system')),
  cancel_reason TEXT,
  cancel_fee_cents INTEGER NOT NULL DEFAULT 0,
  partner_comp_cents INTEGER NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE INDEX jobs_customer_idx ON jobs (customer_id, created_at);

CREATE INDEX jobs_partner_idx ON jobs (partner_id, window_start);

CREATE INDEX jobs_status_idx ON jobs (status, request_expires_at);

-- History of each job: who did what, when. Offers, approvals, cancels, add-ons, money notes.
CREATE TABLE job_events (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
  actor_id TEXT,
  kind TEXT NOT NULL,
  data TEXT,
  created_at BIGINT NOT NULL
);

CREATE INDEX job_events_job_idx ON job_events (job_id, created_at);

CREATE INDEX job_events_actor_idx ON job_events (actor_id, kind, created_at);

-- Add-ons the partner asks for during the job, and glass replacement quotes. Both need the customer's OK.
CREATE TABLE job_addons (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('addon', 'glass')),
  service_id TEXT NOT NULL,
  reason TEXT,
  line TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'declined', 'expired')),
  created_at BIGINT NOT NULL,
  decided_at BIGINT
);

CREATE INDEX job_addons_job_idx ON job_addons (job_id);

-- Account credits (a partner cancelled late, a partner was late to leave). Used on the customer's next completed job.
CREATE TABLE customer_credits (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  cents INTEGER NOT NULL,
  reason TEXT NOT NULL,
  job_id TEXT REFERENCES jobs (id),
  used_on_job_id TEXT REFERENCES jobs (id),
  created_at BIGINT NOT NULL,
  used_at BIGINT
);

CREATE INDEX customer_credits_user_idx ON customer_credits (user_id, used_at);

-- Set when a partner's record needs a staff look (for example, 3 late cancels in 30 days).
ALTER TABLE partner_profiles ADD COLUMN review_reason TEXT;
