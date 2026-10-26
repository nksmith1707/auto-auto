-- Step 4: customer vehicles and saved places, partner service areas and services.
-- Removing a vehicle or place archives it (archived_at) so past jobs can still point to it.
-- lat/lng stay empty until a maps provider is chosen; dispatch (step 7) fills and uses them.

CREATE TABLE vehicles (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  year INTEGER NOT NULL,
  make TEXT NOT NULL,
  model TEXT NOT NULL,
  trim TEXT,
  vin TEXT,
  plate TEXT,
  plate_state TEXT,
  color TEXT,
  mileage INTEGER,
  fuel TEXT NOT NULL CHECK (fuel IN ('gas', 'diesel', 'hybrid', 'electric')),
  oil_preference TEXT,
  nickname TEXT,
  insurer TEXT,
  policy_number TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  archived_at BIGINT
);

CREATE INDEX vehicles_user_idx ON vehicles (user_id);

-- A customer can't add the same VIN twice (archived vehicles don't count).
CREATE UNIQUE INDEX vehicles_user_vin_unique ON vehicles (user_id, vin) WHERE vin IS NOT NULL AND archived_at IS NULL;

-- Where a customer wants service. The street address is private: partners see only city and ZIP
-- until they tap Start Trip on a booked job.
CREATE TABLE places (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  street TEXT NOT NULL,
  unit TEXT,
  city TEXT NOT NULL,
  state TEXT NOT NULL,
  zip TEXT NOT NULL,
  parking TEXT CHECK (parking IN ('driveway', 'street', 'lot', 'garage', 'other')),
  notes TEXT,
  is_default INTEGER NOT NULL DEFAULT 0,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  archived_at BIGINT
);

CREATE INDEX places_user_idx ON places (user_id);

-- Partner home base and how far they'll drive. The base address is private too.
CREATE TABLE partner_service_areas (
  user_id TEXT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  street TEXT NOT NULL,
  city TEXT NOT NULL,
  state TEXT NOT NULL,
  zip TEXT NOT NULL,
  radius_miles INTEGER NOT NULL,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

-- Services each partner offers. IDs come from server/src/catalog/services.js.
CREATE TABLE partner_services (
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  service_id TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (user_id, service_id)
);

-- Cache of VIN lookups from NHTSA, so each VIN is looked up once.
CREATE TABLE vin_decodes (
  vin TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  created_at BIGINT NOT NULL
);
