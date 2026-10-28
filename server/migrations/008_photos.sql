-- Step 10: photos and proof of work.

-- File contents, kept apart from the photo records so lists stay fast. Base64 text works on Postgres and SQLite.
-- When an object store (like Cloudflare R2) is chosen, only this table's role moves there.
CREATE TABLE blobs (
  id TEXT PRIMARY KEY,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  data TEXT NOT NULL,
  created_at BIGINT NOT NULL
);

-- Partner incident reports (damage, injuries, unsafe situations), due within 24 hours.
CREATE TABLE incidents (
  id TEXT PRIMARY KEY,
  reporter_id TEXT NOT NULL REFERENCES users (id),
  job_id TEXT REFERENCES jobs (id),
  type TEXT NOT NULL CHECK (type IN ('vehicle_damage', 'property_damage', 'injury', 'unsafe', 'customer_behavior')),
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  staff_note TEXT,
  created_at BIGINT NOT NULL,
  closed_at BIGINT
);

CREATE INDEX incidents_reporter_idx ON incidents (reporter_id, created_at);

-- Check-in photos (8 outside, 4 inside), after photos, and incident photos.
CREATE TABLE photos (
  id TEXT PRIMARY KEY,
  job_id TEXT REFERENCES jobs (id) ON DELETE CASCADE,
  incident_id TEXT REFERENCES incidents (id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('checkin', 'after', 'incident')),
  slot TEXT NOT NULL,
  blob_id TEXT NOT NULL REFERENCES blobs (id),
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  damage_note TEXT,
  uploaded_by TEXT NOT NULL REFERENCES users (id),
  created_at BIGINT NOT NULL,
  replaced_at BIGINT
);

CREATE INDEX photos_job_idx ON photos (job_id, kind);
CREATE INDEX photos_incident_idx ON photos (incident_id);
