-- =============================================
-- ELS PLATFORM — SUPABASE DATABASE SCHEMA
-- =============================================
-- Run this against your Supabase SQL Editor.
-- Enables PostGIS, creates all enums, tables,
-- foreign keys, indexes, and RLS policies.
-- =============================================


-- 0. EXTENSIONS
-- =============================================
CREATE EXTENSION IF NOT EXISTS "postgis";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";


-- 1. ENUM TYPES
-- =============================================

CREATE TYPE user_role AS ENUM ('passenger', 'driver', 'admin');

CREATE TYPE passenger_tier AS ENUM ('silver', 'gold', 'platinum');

CREATE TYPE subscription_status AS ENUM ('active', 'suspended');

CREATE TYPE driver_status AS ENUM ('offline', 'available', 'on_job');

CREATE TYPE vehicle_class AS ENUM ('executive', 'first_class', 'suv_xl', 'van');

CREATE TYPE ride_status AS ENUM (
  'pending',
  'dispatched',
  'en_route',
  'arrived',
  'in_progress',
  'completed',
  'cancelled'
);

CREATE TYPE dispatch_type AS ENUM ('internal', 'outsourced_supplier');

CREATE TYPE audit_type AS ENUM ('start_of_shift', 'end_of_shift');

CREATE TYPE alloys_condition AS ENUM ('perfect', 'scuffed', 'damaged');

CREATE TYPE invoice_status AS ENUM ('draft', 'sent', 'paid', 'overdue');


-- 2. CORE USER & HARVESTING LAYER
-- =============================================

CREATE TABLE global_users (
  id            UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  phone_number  TEXT UNIQUE NOT NULL,
  role          user_role NOT NULL DEFAULT 'passenger',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE global_users IS 'Base table for all app users. Linked to Supabase Auth for phone-verified identities.';


-- 3. B2B CLIENT LAYER
-- =============================================

CREATE TABLE corporate_accounts (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  club_name       TEXT NOT NULL,
  billing_email   TEXT NOT NULL,
  brand_color_hex TEXT DEFAULT '#FFFFFF',
  logo_url        TEXT,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE corporate_accounts IS 'Clubs and corporate clients that receive weekly invoices.';

CREATE TABLE passenger_profiles (
  user_id              UUID PRIMARY KEY REFERENCES global_users(id) ON DELETE CASCADE,
  full_name            TEXT NOT NULL,
  tier                 passenger_tier NOT NULL DEFAULT 'silver',
  corporate_account_id UUID REFERENCES corporate_accounts(id) ON DELETE SET NULL,
  available_credits    DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  preferences          JSONB NOT NULL DEFAULT '{}'::JSONB,
  stripe_customer_id   TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE passenger_profiles IS 'Extended passenger data. Links Players to their Clubs.';
COMMENT ON COLUMN passenger_profiles.preferences IS 'Luxury needs: {"temp": 21, "music": "jazz", "conversation": "silent", "beverage": "sparkling"}';


-- 4. SUPPLY SIDE
-- =============================================

CREATE TABLE driver_businesses (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_name        TEXT NOT NULL,
  subscription_status subscription_status NOT NULL DEFAULT 'active',
  payout_account_id   TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE driver_businesses IS 'Fleet operators who pay a subscription to ELS.';

CREATE TABLE drivers (
  user_id          UUID PRIMARY KEY REFERENCES global_users(id) ON DELETE CASCADE,
  business_id      UUID NOT NULL REFERENCES driver_businesses(id) ON DELETE CASCADE,
  full_name        TEXT NOT NULL,
  license_number   TEXT NOT NULL,
  current_status   driver_status NOT NULL DEFAULT 'offline',
  current_location GEOGRAPHY(POINT, 4326),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE drivers IS 'Individual chauffeurs linked to their fleet business.';

CREATE TABLE vehicles (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id        UUID NOT NULL REFERENCES driver_businesses(id) ON DELETE CASCADE,
  registration_plate TEXT UNIQUE NOT NULL,
  make_model         TEXT NOT NULL,
  vehicle_class      vehicle_class NOT NULL DEFAULT 'executive',
  color              TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE vehicles IS 'Luxury fleet managed by driver businesses.';


-- 5. PRICING ENGINE
-- =============================================

CREATE TABLE rate_cards (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id          UUID NOT NULL REFERENCES driver_businesses(id) ON DELETE CASCADE,
  corporate_account_id UUID REFERENCES corporate_accounts(id) ON DELETE SET NULL,
  vehicle_class        vehicle_class NOT NULL,
  base_fare            DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  price_per_mile       DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  waiting_time_per_min DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- A business can only have one rate per vehicle class per corporate account
  UNIQUE (business_id, corporate_account_id, vehicle_class)
);

COMMENT ON TABLE rate_cards IS 'Custom pricing per business, with optional corporate overrides.';
COMMENT ON COLUMN rate_cards.corporate_account_id IS 'NULL = general public rate. Set = special rate for that specific Club.';


-- 6. DISPATCH & JOURNEY ENGINE
-- =============================================

CREATE TABLE rides (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  passenger_id         UUID NOT NULL REFERENCES global_users(id),
  driver_id            UUID REFERENCES global_users(id),
  vehicle_id           UUID REFERENCES vehicles(id),
  corporate_account_id UUID REFERENCES corporate_accounts(id) ON DELETE SET NULL,
  rate_card_id         UUID REFERENCES rate_cards(id),

  status               ride_status NOT NULL DEFAULT 'pending',
  dispatch_type        dispatch_type NOT NULL DEFAULT 'internal',

  pickup_address       TEXT NOT NULL,
  pickup_coords        GEOGRAPHY(POINT, 4326),
  dropoff_address      TEXT NOT NULL,
  dropoff_coords       GEOGRAPHY(POINT, 4326),
  waypoints            JSONB DEFAULT '[]'::JSONB,

  flight_number        TEXT,
  masked_proxy_number  TEXT,

  scheduled_at         TIMESTAMPTZ,
  started_at           TIMESTAMPTZ,
  completed_at         TIMESTAMPTZ,

  total_mileage        DECIMAL(10, 2) DEFAULT 0.00,
  total_waiting_time_mins INTEGER DEFAULT 0,
  final_calculated_price  DECIMAL(10, 2),

  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE rides IS 'Core job sheet. Handles tracking, multi-stop, outsourcing.';
COMMENT ON COLUMN rides.dispatch_type IS 'Drives the Light Green / Light Blue UI logic in Admin app.';


-- 7. OPERATIONS & AUDITING
-- =============================================

CREATE TABLE vehicle_audits (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  driver_id         UUID NOT NULL REFERENCES global_users(id),
  vehicle_id        UUID NOT NULL REFERENCES vehicles(id),
  audit_type        audit_type NOT NULL,
  fuel_level        INTEGER CHECK (fuel_level >= 0 AND fuel_level <= 100),
  alloys_condition  alloys_condition NOT NULL DEFAULT 'perfect',
  stock_replenished BOOLEAN NOT NULL DEFAULT FALSE,
  photo_urls        JSONB DEFAULT '[]'::JSONB,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE vehicle_audits IS 'Pre/Post shift checklists for chauffeurs.';


-- 8. BILLING & INVOICING
-- =============================================

CREATE TABLE invoices (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  corporate_account_id UUID NOT NULL REFERENCES corporate_accounts(id) ON DELETE CASCADE,
  billing_period_start DATE NOT NULL,
  billing_period_end   DATE NOT NULL,
  total_amount         DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  status               invoice_status NOT NULL DEFAULT 'draft',
  ride_ids             JSONB DEFAULT '[]'::JSONB,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE invoices IS 'Weekly automated billing for B2B Corporate Clubs.';


-- 9. PERFORMANCE INDEXES
-- =============================================

-- Fast lookup: find available drivers near a location
CREATE INDEX idx_drivers_status ON drivers (current_status);
CREATE INDEX idx_drivers_location ON drivers USING GIST (current_location);

-- Fast lookup: rides by status for dispatch board
CREATE INDEX idx_rides_status ON rides (status);
CREATE INDEX idx_rides_passenger ON rides (passenger_id);
CREATE INDEX idx_rides_driver ON rides (driver_id);
CREATE INDEX idx_rides_corporate ON rides (corporate_account_id);
CREATE INDEX idx_rides_scheduled ON rides (scheduled_at) WHERE scheduled_at IS NOT NULL;

-- Fast lookup: invoices by status for billing
CREATE INDEX idx_invoices_status ON invoices (status);
CREATE INDEX idx_invoices_corporate ON invoices (corporate_account_id);

-- Fast lookup: rate cards for pricing engine
CREATE INDEX idx_rate_cards_business ON rate_cards (business_id);
CREATE INDEX idx_rate_cards_corporate ON rate_cards (corporate_account_id);

-- Fast lookup: vehicles by business
CREATE INDEX idx_vehicles_business ON vehicles (business_id);

-- Fast lookup: audits by vehicle
CREATE INDEX idx_audits_vehicle ON vehicle_audits (vehicle_id);


-- 10. ROW LEVEL SECURITY
-- =============================================

ALTER TABLE global_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE passenger_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE drivers ENABLE ROW LEVEL SECURITY;
ALTER TABLE rides ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_audits ENABLE ROW LEVEL SECURITY;
ALTER TABLE corporate_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE driver_businesses ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;

-- Users can read their own row
CREATE POLICY "Users can read own profile"
  ON global_users FOR SELECT
  USING (auth.uid() = id);

-- Passengers can read and update their own profile
CREATE POLICY "Passengers can read own profile"
  ON passenger_profiles FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Passengers can update own profile"
  ON passenger_profiles FOR UPDATE
  USING (auth.uid() = user_id);

-- Drivers can read and update their own record
CREATE POLICY "Drivers can read own record"
  ON drivers FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Drivers can update own status and location"
  ON drivers FOR UPDATE
  USING (auth.uid() = user_id);

-- Passengers can see their own rides
CREATE POLICY "Passengers can read own rides"
  ON rides FOR SELECT
  USING (auth.uid() = passenger_id);

-- Drivers can see rides assigned to them
CREATE POLICY "Drivers can read assigned rides"
  ON rides FOR SELECT
  USING (auth.uid() = driver_id);

-- Drivers can create audits for their shifts
CREATE POLICY "Drivers can create audits"
  ON vehicle_audits FOR INSERT
  WITH CHECK (auth.uid() = driver_id);

CREATE POLICY "Drivers can read own audits"
  ON vehicle_audits FOR SELECT
  USING (auth.uid() = driver_id);

-- Public read for vehicles (passengers need to see what's available)
CREATE POLICY "Authenticated users can view vehicles"
  ON vehicles FOR SELECT
  TO authenticated
  USING (true);

-- Public read for rate cards (passengers need pricing)
CREATE POLICY "Authenticated users can view rate cards"
  ON rate_cards FOR SELECT
  TO authenticated
  USING (true);

-- Admin full access policies (relies on the role in global_users)
-- These use a helper function to check admin role

CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM global_users
    WHERE id = auth.uid() AND role = 'admin'
  );
$$ LANGUAGE SQL SECURITY DEFINER STABLE;

CREATE POLICY "Admins have full access to global_users"
  ON global_users FOR ALL
  USING (is_admin());

CREATE POLICY "Admins have full access to corporate_accounts"
  ON corporate_accounts FOR ALL
  USING (is_admin());

CREATE POLICY "Admins have full access to driver_businesses"
  ON driver_businesses FOR ALL
  USING (is_admin());

CREATE POLICY "Admins have full access to vehicles"
  ON vehicles FOR ALL
  USING (is_admin());

CREATE POLICY "Admins have full access to rides"
  ON rides FOR ALL
  USING (is_admin());

CREATE POLICY "Admins have full access to invoices"
  ON invoices FOR ALL
  USING (is_admin());

CREATE POLICY "Admins have full access to rate_cards"
  ON rate_cards FOR ALL
  USING (is_admin());

CREATE POLICY "Admins have full access to vehicle_audits"
  ON vehicle_audits FOR ALL
  USING (is_admin());


-- 11. AUTO-UPDATE TIMESTAMPS
-- =============================================

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_passenger_profiles_updated
  BEFORE UPDATE ON passenger_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_drivers_updated
  BEFORE UPDATE ON drivers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_rides_updated
  BEFORE UPDATE ON rides
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_invoices_updated
  BEFORE UPDATE ON invoices
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- =============================================
-- SCHEMA COMPLETE
-- =============================================
