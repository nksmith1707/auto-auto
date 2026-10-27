-- Step 7: dispatch. Map locations for addresses, offers to partners one at a time, and in-app messages.

-- Whether an address was found on the map: ok, not_found, or error (try again later).
ALTER TABLE places ADD COLUMN geo_status TEXT;

ALTER TABLE partner_service_areas ADD COLUMN geo_status TEXT;

-- Where the job is (copied from the place at booking) and how the search for a partner is going.
ALTER TABLE jobs ADD COLUMN lat DOUBLE PRECISION;

ALTER TABLE jobs ADD COLUMN lng DOUBLE PRECISION;

-- offers: one partner at a time (instant jobs). board: everyone in range can see it.
ALTER TABLE jobs ADD COLUMN dispatch_phase TEXT NOT NULL DEFAULT 'board';

ALTER TABLE jobs ADD COLUMN offers_sent INTEGER NOT NULL DEFAULT 0;

ALTER TABLE jobs ADD COLUMN widened_at BIGINT;

-- Each offer to a partner: who, how far, when it runs out, and what they did.
CREATE TABLE job_offers (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
  partner_id TEXT NOT NULL REFERENCES users (id),
  distance_miles DOUBLE PRECISION,
  status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'declined', 'expired')),
  sent_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL,
  decided_at BIGINT
);

CREATE INDEX job_offers_job_idx ON job_offers (job_id, status);

CREATE INDEX job_offers_partner_idx ON job_offers (partner_id, status, expires_at);

-- In-app chat between the customer and their partner. Phone numbers are hidden before saving.
CREATE TABLE job_messages (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
  sender_id TEXT NOT NULL REFERENCES users (id),
  sender_role TEXT NOT NULL CHECK (sender_role IN ('customer', 'partner')),
  body TEXT NOT NULL,
  created_at BIGINT NOT NULL
);

CREATE INDEX job_messages_job_idx ON job_messages (job_id, created_at);
