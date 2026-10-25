-- Accounts for customers, partners (service members), and Auto-Auto staff.
-- Portable between Postgres and SQLite: TEXT ids (UUIDs made by the app), BIGINT millisecond timestamps.

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  role TEXT NOT NULL CHECK (role IN ('customer', 'partner', 'admin')),
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  phone TEXT,
  email_verified_at BIGINT,
  disabled_at BIGINT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

-- One account per email. Emails are stored lowercase.
CREATE UNIQUE INDEX users_email_unique ON users (email);

-- Partner application status. Partners can sign in right away but can't take jobs until approved.
CREATE TABLE partner_profiles (
  user_id TEXT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('applicant', 'in_review', 'active', 'paused', 'deactivated')),
  status_reason TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

-- Sign-in sessions. Only a SHA-256 hash of each token is stored, never the token itself.
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  device TEXT,
  created_at BIGINT NOT NULL,
  last_used_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL,
  revoked_at BIGINT
);

CREATE UNIQUE INDEX sessions_token_hash_unique ON sessions (token_hash);

CREATE INDEX sessions_user_idx ON sessions (user_id);

-- Password reset links. Single use, short lived, stored hashed.
CREATE TABLE password_resets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL,
  used_at BIGINT
);

CREATE UNIQUE INDEX password_resets_token_hash_unique ON password_resets (token_hash);

-- Security log: sign-ins, failed sign-ins, password changes. Kept for support and fraud review.
CREATE TABLE auth_events (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  kind TEXT NOT NULL,
  ip TEXT,
  created_at BIGINT NOT NULL
);

CREATE INDEX auth_events_user_idx ON auth_events (user_id);
