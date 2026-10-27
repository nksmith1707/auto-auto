-- Step 9: partner onboarding. Answers, uploaded documents, and signatures.
-- Never stored here: SSN/EIN and bank numbers (Stripe collects them), driver's license numbers and ID photos
-- (Stripe Identity checks them; we keep only the result).

CREATE TABLE partner_applications (
  user_id TEXT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  legal_first TEXT,
  legal_middle TEXT,
  legal_last TEXT,
  -- Answers for each step, as JSON: { business: {...}, identity: {...}, insurance: {...}, ... }
  answers TEXT NOT NULL DEFAULT '{}',
  identity_session_id TEXT,
  identity_status TEXT NOT NULL DEFAULT 'not_started' CHECK (identity_status IN ('not_started', 'requires_input', 'processing', 'verified', 'canceled', 'failed')),
  identity_over_21 INTEGER,
  identity_checked_at BIGINT,
  background_status TEXT NOT NULL DEFAULT 'not_started' CHECK (background_status IN ('not_started', 'pending', 'clear', 'consider', 'adverse')),
  background_note TEXT,
  background_updated_at BIGINT,
  submitted_at BIGINT,
  decided_at BIGINT,
  decided_by TEXT,
  decision TEXT,
  decision_note TEXT,
  arbitration_opt_out_at BIGINT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

-- Certificates and licenses. Stored as base64 text so it works the same on Postgres and SQLite.
CREATE TABLE partner_documents (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  data TEXT NOT NULL,
  expires_on TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  review_note TEXT,
  reviewed_by TEXT,
  replaced_at BIGINT,
  created_at BIGINT NOT NULL
);

CREATE INDEX partner_documents_user_idx ON partner_documents (user_id, kind);

-- One row per signature or acknowledgement. Keeps the exact document version and a fingerprint of its text.
CREATE TABLE partner_signatures (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  doc_id TEXT NOT NULL,
  doc_version TEXT NOT NULL,
  doc_hash TEXT NOT NULL,
  signed_name TEXT,
  ip TEXT,
  user_agent TEXT,
  signed_at BIGINT NOT NULL,
  revoked_at BIGINT
);

CREATE INDEX partner_signatures_user_idx ON partner_signatures (user_id, doc_id);
