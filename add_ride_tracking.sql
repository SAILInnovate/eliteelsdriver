-- Ride tracking & billing fields migration
-- Adds operational timing, mileage, driver status events, and billing breakdown
-- Run in Supabase SQL Editor

-- =============================================
-- EXTEND RIDE STATUS ENUM
-- =============================================

-- Add 'scheduled' and 'cancelled' to ride_status (safe to run multiple times)
DO $$
BEGIN
  ALTER TYPE ride_status ADD VALUE IF NOT EXISTS 'scheduled';
  ALTER TYPE ride_status ADD VALUE IF NOT EXISTS 'cancelled';
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Cancellation tracking
ALTER TABLE rides ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
ALTER TABLE rides ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;

-- =============================================
-- TIMING & MILEAGE TRACKING
-- =============================================

-- When driver arrives on location
ALTER TABLE rides ADD COLUMN IF NOT EXISTS arrived_at TIMESTAMPTZ;

-- When passengers are on board (POB)
ALTER TABLE rides ADD COLUMN IF NOT EXISTS pob_at TIMESTAMPTZ;

-- When ride ends (drop-off complete)
ALTER TABLE rides ADD COLUMN IF NOT EXISTS dropoff_at TIMESTAMPTZ;

-- Wait time: time between arrived_at and pob_at (calculated, but stored for billing)
ALTER TABLE rides ADD COLUMN IF NOT EXISTS wait_time_mins INTEGER DEFAULT 0;

-- Active journey time in minutes (pob_at to dropoff_at)
ALTER TABLE rides ADD COLUMN IF NOT EXISTS journey_time_mins INTEGER DEFAULT 0;

-- Total distance in miles (GPS tracked by driver app)
ALTER TABLE rides ADD COLUMN IF NOT EXISTS distance_miles DECIMAL(10, 2) DEFAULT 0.00;

-- Detour miles beyond the planned route (for surcharge billing)
ALTER TABLE rides ADD COLUMN IF NOT EXISTS detour_miles DECIMAL(10, 2) DEFAULT 0.00;

-- =============================================
-- BILLING BREAKDOWN
-- =============================================

-- Service type: by_the_hour | one_way | vip_security
ALTER TABLE rides ADD COLUMN IF NOT EXISTS service_type TEXT;

-- Booked hours (By The Hour service)
ALTER TABLE rides ADD COLUMN IF NOT EXISTS booked_hours INTEGER;

-- Actual hours used (may exceed booked_hours = extra charges)
ALTER TABLE rides ADD COLUMN IF NOT EXISTS actual_hours DECIMAL(6, 2);

-- Base rate applied (per hour or per zone)
ALTER TABLE rides ADD COLUMN IF NOT EXISTS base_rate DECIMAL(10, 2);

-- Zone number matched (One Way)
ALTER TABLE rides ADD COLUMN IF NOT EXISTS zone_matched INTEGER;

-- Vehicle class used
ALTER TABLE rides ADD COLUMN IF NOT EXISTS vehicle_class TEXT;

-- Security package ID (VIP Security)
ALTER TABLE rides ADD COLUMN IF NOT EXISTS security_package_id TEXT;

-- Surcharges applied (array of {id, name, amount})
ALTER TABLE rides ADD COLUMN IF NOT EXISTS surcharges_applied JSONB DEFAULT '[]'::JSONB;

-- Subtotal before VAT
ALTER TABLE rides ADD COLUMN IF NOT EXISTS subtotal DECIMAL(10, 2);

-- VAT amount
ALTER TABLE rides ADD COLUMN IF NOT EXISTS vat_amount DECIMAL(10, 2);

-- Is this an anti-social hours booking (00:00-06:00)?
ALTER TABLE rides ADD COLUMN IF NOT EXISTS is_antisocial BOOLEAN DEFAULT false;

-- Is this a match day booking?
ALTER TABLE rides ADD COLUMN IF NOT EXISTS is_match_day BOOLEAN DEFAULT false;

-- =============================================
-- DRIVER STATUS EVENTS LOG
-- The driver app will INSERT into this table at each milestone
-- =============================================

CREATE TABLE IF NOT EXISTS ride_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ride_id UUID NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
  driver_id UUID REFERENCES global_users(id),
  event_type TEXT NOT NULL,  -- 'on_location', 'pob', 'eta_update', 'dropoff', 'cancelled', 'detour', 'break_start', 'break_end'
  event_data JSONB DEFAULT '{}',  -- flexible: { eta_minutes: 12 }, { detour_reason: 'client request' }
  location_coords GEOGRAPHY(POINT, 4326),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE ride_events IS 'Immutable log of driver status updates during a ride. Used for billing audit trail and client notifications.';

-- Index for fast event lookups by ride
CREATE INDEX IF NOT EXISTS idx_ride_events_ride ON ride_events (ride_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ride_events_driver ON ride_events (driver_id);

-- =============================================
-- DRIVER LOCATION BREADCRUMBS (for live tracking)
-- =============================================

CREATE TABLE IF NOT EXISTS driver_locations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ride_id UUID REFERENCES rides(id) ON DELETE SET NULL,
  driver_id UUID NOT NULL REFERENCES global_users(id),
  coords GEOGRAPHY(POINT, 4326) NOT NULL,
  heading DECIMAL(5, 2),      -- compass bearing 0-360
  speed_mph DECIMAL(6, 2),    -- for mileage verification
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE driver_locations IS 'GPS breadcrumb trail. Written every 5-10s by driver app. Used for live map + mileage calc + billing audit.';

-- Fast lookups: most recent location per driver, locations per ride
CREATE INDEX IF NOT EXISTS idx_driver_loc_driver ON driver_locations (driver_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_driver_loc_ride ON driver_locations (ride_id, recorded_at);

-- =============================================
-- METADATA COLUMN (already used by client app)
-- =============================================

ALTER TABLE rides ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';

COMMENT ON COLUMN rides.metadata IS 'Flexible JSON for client-side booking details: security_package, stop_count, vehicle preferences, etc.';

-- =============================================
-- DRIVER PROFILE FIELDS
-- =============================================

-- Driver display name (for client-facing "James R.")
ALTER TABLE rides ADD COLUMN IF NOT EXISTS driver_name TEXT;

-- Driver phone (for comms)
ALTER TABLE rides ADD COLUMN IF NOT EXISTS driver_phone TEXT;

-- Vehicle reg plate
ALTER TABLE rides ADD COLUMN IF NOT EXISTS vehicle_reg TEXT;

-- =============================================
-- RLS POLICIES for new tables
-- =============================================

ALTER TABLE ride_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE driver_locations ENABLE ROW LEVEL SECURITY;

-- Drop existing policies first (safe to re-run)
DROP POLICY IF EXISTS "Passengers can read own ride events" ON ride_events;
DROP POLICY IF EXISTS "Drivers can insert ride events" ON ride_events;
DROP POLICY IF EXISTS "Drivers can read own ride events" ON ride_events;
DROP POLICY IF EXISTS "Drivers can insert own locations" ON driver_locations;
DROP POLICY IF EXISTS "Passengers can read driver location for own ride" ON driver_locations;

-- Passengers can see events for their own rides
CREATE POLICY "Passengers can read own ride events" ON ride_events
  FOR SELECT USING (
    ride_id IN (SELECT id FROM rides WHERE passenger_id = auth.uid())
  );

-- Drivers can insert and read events for their assigned rides
CREATE POLICY "Drivers can insert ride events" ON ride_events
  FOR INSERT WITH CHECK (driver_id = auth.uid());

CREATE POLICY "Drivers can read own ride events" ON ride_events
  FOR SELECT USING (driver_id = auth.uid());

-- Driver can write their own locations
CREATE POLICY "Drivers can insert own locations" ON driver_locations
  FOR INSERT WITH CHECK (driver_id = auth.uid());

-- Passengers can see driver location for their active ride
CREATE POLICY "Passengers can read driver location for own ride" ON driver_locations
  FOR SELECT USING (
    ride_id IN (SELECT id FROM rides WHERE passenger_id = auth.uid())
  );
