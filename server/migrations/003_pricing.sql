-- Step 5: versioned pricing & rules settings (the Ops Console's "Pricing & rules" page).
-- Every change is a new row; nothing is edited in place. Quotes and bookings record the version they used,
-- so a change only applies to bookings made after it's published. Version 1 is created by the server on first start.

CREATE TABLE pricing_settings (
  version INTEGER PRIMARY KEY,
  settings TEXT NOT NULL,
  note TEXT NOT NULL,
  created_by TEXT REFERENCES users (id) ON DELETE SET NULL,
  created_at BIGINT NOT NULL
);

-- The bulb quick fix split into headlight and brake/tail bulbs. Partners who offered it keep both.
INSERT INTO partner_services (user_id, service_id, created_at)
  SELECT user_id, 'quick_tail_bulb', created_at FROM partner_services WHERE service_id = 'quick_bulbs';

UPDATE partner_services SET service_id = 'quick_headlight_bulb' WHERE service_id = 'quick_bulbs';
