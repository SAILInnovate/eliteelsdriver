-- Rate card tables for Elite ELS
-- Run this in Supabase SQL Editor

-- Vehicle rates (By The Hour)
CREATE TABLE IF NOT EXISTS vehicle_rates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  per_hour DECIMAL(10,2) NOT NULL,
  min_hours INT NOT NULL DEFAULT 3,
  seats INT NOT NULL DEFAULT 3,
  sort_order INT NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Zonal rates (One Way transfers)
CREATE TABLE IF NOT EXISTS zone_rates (
  id SERIAL PRIMARY KEY,
  zone_number INT NOT NULL,
  name TEXT NOT NULL,
  mercs_price DECIMAL(10,2) NOT NULL,
  range_price DECIMAL(10,2) NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Airport rates
CREATE TABLE IF NOT EXISTS airport_rates (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  mercs_price DECIMAL(10,2) NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Security packages
CREATE TABLE IF NOT EXISTS security_packages (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  base_price DECIMAL(10,2) NOT NULL,
  additional_hour DECIMAL(10,2) NOT NULL,
  min_hours INT NOT NULL DEFAULT 6,
  sort_order INT NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Surcharges & extras
CREATE TABLE IF NOT EXISTS surcharges (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  amount DECIMAL(10,2) NOT NULL,
  is_percentage BOOLEAN NOT NULL DEFAULT false,
  active BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ========= SEED DATA =========

-- Vehicles
INSERT INTO vehicle_rates (id, name, description, per_hour, min_hours, seats, sort_order) VALUES
  ('s_class', 'MERCEDES S CLASS', 'Executive', 75.00, 3, 3, 1),
  ('viano', 'MERCEDES VIANO', 'XL Class', 75.00, 3, 7, 2),
  ('range_rover', 'RANGE ROVER', 'First Class', 125.00, 3, 3, 3),
  ('sprinter', 'MERCEDES SPRINTER', 'Group', 150.00, 3, 12, 4),
  ('minibus', '16 SEAT MINIBUS', 'Group', 150.00, 3, 16, 5)
ON CONFLICT (id) DO UPDATE SET
  per_hour = EXCLUDED.per_hour,
  min_hours = EXCLUDED.min_hours,
  seats = EXCLUDED.seats,
  name = EXCLUDED.name,
  updated_at = NOW();

-- Zones
INSERT INTO zone_rates (zone_number, name, mercs_price, range_price) VALUES
  (1, 'Manchester Central', 75.00, 75.00),
  (2, 'East Cheshire', 90.00, 90.00),
  (3, 'West Cheshire & Merseyside', 240.00, 240.00),
  (4, 'Lancashire & West Yorkshire', 290.00, 290.00),
  (5, 'N Midlands & E Yorkshire', 490.00, 490.00),
  (6, 'Birmingham Central', 525.00, 525.00),
  (7, 'East Midlands', 620.00, 620.00),
  (8, 'Bedfordshire & Tyneside', 690.00, 690.00),
  (9, 'North & West London', 745.00, 745.00),
  (10, 'South & East London', 870.00, 870.00),
  (11, 'S South Coast & East Anglia', 870.00, 870.00),
  (12, 'E South Coast / Aberdeen / Scotland', 1010.00, 1010.00)
ON CONFLICT DO NOTHING;

-- Airports
INSERT INTO airport_rates (name, mercs_price) VALUES
  ('Manchester', 75.00),
  ('Liverpool', 240.00),
  ('Leeds/Bradford', 260.00),
  ('Birmingham', 525.00),
  ('East Midlands', 525.00),
  ('Heathrow', 745.00),
  ('London City', 870.00),
  ('Luton', 745.00),
  ('Gatwick', 870.00),
  ('Stanstead', 870.00)
ON CONFLICT DO NOTHING;

-- Security packages
INSERT INTO security_packages (id, name, description, base_price, additional_hour, min_hours, sort_order) VALUES
  ('cpo_only', 'CPO OFFICER', 'Medium risk • 6hr min', 360.00, 60.00, 6, 1),
  ('sas_only', 'SAS OFFICER', 'High risk • 6hr min', 750.00, 125.00, 6, 2),
  ('driver_only', 'STANDBY DRIVER', 'Driver only • 6hr min', 450.00, 75.00, 6, 3),
  ('driver_cpo', 'DRIVER + CPO', 'Driver + 1 CPO • 6hr min', 810.00, 135.00, 6, 4),
  ('driver_2cpo', 'DRIVER + 2 CPO', 'Driver + 2 CPO • 6hr min', 1170.00, 195.00, 6, 5),
  ('driver_sas', 'DRIVER + SAS', 'Driver + 1 SAS • 6hr min', 1200.00, 200.00, 6, 6),
  ('driver_2sas', 'DRIVER + 2 SAS', 'Full detail • 6hr min', 1950.00, 325.00, 6, 7)
ON CONFLICT (id) DO UPDATE SET
  base_price = EXCLUDED.base_price,
  additional_hour = EXCLUDED.additional_hour,
  name = EXCLUDED.name,
  updated_at = NOW();

-- Surcharges
INSERT INTO surcharges (id, name, description, amount) VALUES
  ('antisocial_15mi', 'Anti-social hours (within 15mi)', '00:00-06:00, within 15mi of Manchester', 37.50),
  ('antisocial_beyond', 'Anti-social hours (beyond 15mi)', '00:00-06:00, beyond 15mi of Manchester', 75.00),
  ('match_day', 'Match day transfer', '3hrs before KO to 3hrs after, 3hr min', 225.00),
  ('signature_dropoff', 'Signature drop-off', 'CFA or equivalent', 75.00),
  ('detour_mercs', 'Route detour mileage (Mercs)', 'Per mile', 3.75),
  ('detour_range', 'Route detour mileage (Range/16 seat)', 'Per mile', 6.25),
  ('7day_discount', '7-day hire discount', '10% off standard rates', 10.00)
ON CONFLICT (id) DO UPDATE SET
  amount = EXCLUDED.amount,
  name = EXCLUDED.name,
  updated_at = NOW();

-- Enable RLS
ALTER TABLE vehicle_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE zone_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE airport_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE security_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE surcharges ENABLE ROW LEVEL SECURITY;

-- Public read access (anyone can see rates)
CREATE POLICY "Public read vehicle_rates" ON vehicle_rates FOR SELECT USING (true);
CREATE POLICY "Public read zone_rates" ON zone_rates FOR SELECT USING (true);
CREATE POLICY "Public read airport_rates" ON airport_rates FOR SELECT USING (true);
CREATE POLICY "Public read security_packages" ON security_packages FOR SELECT USING (true);
CREATE POLICY "Public read surcharges" ON surcharges FOR SELECT USING (true);
