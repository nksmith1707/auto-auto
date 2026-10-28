-- Step 11: fleet (business) accounts, vehicles, multi-vehicle visits ("runs"), add-ons, and invoices.

CREATE TABLE fleets (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users (id),
  name TEXT NOT NULL,
  manager_name TEXT NOT NULL,
  billing_email TEXT NOT NULL,
  yard_street TEXT NOT NULL,
  yard_city TEXT NOT NULL,
  yard_state TEXT NOT NULL,
  yard_zip TEXT NOT NULL,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  yard_hours TEXT NOT NULL,
  checkin_notes TEXT NOT NULL,
  terms TEXT NOT NULL CHECK (terms IN ('net30', 'card')),
  status TEXT NOT NULL CHECK (status IN ('review', 'active', 'declined', 'paused')),
  credit_limit_cents INTEGER NOT NULL DEFAULT 0,
  labor_rate DOUBLE PRECISION NOT NULL,
  auto_approve_cents INTEGER NOT NULL DEFAULT 0,
  po_required INTEGER NOT NULL DEFAULT 0,
  decision_note TEXT,
  decided_at BIGINT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE UNIQUE INDEX fleets_owner_unique ON fleets (owner_id);

CREATE TABLE fleet_vehicles (
  id TEXT PRIMARY KEY,
  fleet_id TEXT NOT NULL REFERENCES fleets (id) ON DELETE CASCADE,
  unit TEXT NOT NULL,
  year INTEGER NOT NULL,
  make TEXT NOT NULL,
  model TEXT NOT NULL,
  vehicle_class TEXT NOT NULL CHECK (vehicle_class IN ('van_pickup', 'box_truck', 'tractor', 'trailer')),
  plate TEXT,
  vin TEXT,
  mileage INTEGER,
  next_oil_miles INTEGER,
  dot_due TEXT,
  archived_at BIGINT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE INDEX fleet_vehicles_fleet_idx ON fleet_vehicles (fleet_id);

CREATE TABLE fleet_runs (
  id TEXT PRIMARY KEY,
  number INTEGER NOT NULL,
  fleet_id TEXT NOT NULL REFERENCES fleets (id),
  status TEXT NOT NULL CHECK (status IN ('posted', 'claimed', 'active', 'completed', 'cancelled')),
  partner_id TEXT REFERENCES users (id),
  window_start BIGINT NOT NULL,
  window_end BIGINT NOT NULL,
  po TEXT,
  service_ids TEXT NOT NULL,
  settings_version INTEGER NOT NULL,
  labor_rate DOUBLE PRECISION NOT NULL,
  estimate_cents INTEGER NOT NULL,
  excluded_partners TEXT NOT NULL DEFAULT '[]',
  partner_pay TEXT,
  cancel_fee_cents INTEGER NOT NULL DEFAULT 0,
  cancel_reason TEXT,
  created_at BIGINT NOT NULL,
  claimed_at BIGINT,
  started_at BIGINT,
  completed_at BIGINT,
  cancelled_at BIGINT,
  updated_at BIGINT NOT NULL
);

CREATE UNIQUE INDEX fleet_runs_number_unique ON fleet_runs (number);
CREATE INDEX fleet_runs_fleet_idx ON fleet_runs (fleet_id, status);

-- One vehicle on a run: its own photos, odometer, inspection, notes, and priced lines.
CREATE TABLE fleet_run_vehicles (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES fleet_runs (id) ON DELETE CASCADE,
  vehicle_id TEXT NOT NULL REFERENCES fleet_vehicles (id),
  status TEXT NOT NULL CHECK (status IN ('scheduled', 'checkin', 'service', 'done', 'skipped')),
  lines TEXT NOT NULL,
  skipped_services TEXT NOT NULL DEFAULT '[]',
  odometer INTEGER,
  inspection TEXT,
  notes TEXT,
  skip_reason TEXT,
  done_at BIGINT
);

CREATE INDEX fleet_run_vehicles_run_idx ON fleet_run_vehicles (run_id);

CREATE TABLE fleet_addons (
  id TEXT PRIMARY KEY,
  run_vehicle_id TEXT NOT NULL REFERENCES fleet_run_vehicles (id) ON DELETE CASCADE,
  service_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  line TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'declined')),
  auto_approved INTEGER NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL,
  decided_at BIGINT
);

CREATE TABLE fleet_invoices (
  id TEXT PRIMARY KEY,
  number INTEGER NOT NULL,
  fleet_id TEXT NOT NULL REFERENCES fleets (id),
  run_id TEXT REFERENCES fleet_runs (id),
  po TEXT,
  lines TEXT NOT NULL,
  total_cents INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open', 'paid', 'void')),
  issued_at BIGINT NOT NULL,
  due_at BIGINT NOT NULL,
  paid_at BIGINT,
  paid_note TEXT,
  stripe_id TEXT,
  payment_error TEXT
);

CREATE UNIQUE INDEX fleet_invoices_number_unique ON fleet_invoices (number);

-- Fleet vehicle photos use the same photo store as jobs.
ALTER TABLE photos ADD COLUMN run_vehicle_id TEXT REFERENCES fleet_run_vehicles (id) ON DELETE CASCADE;
