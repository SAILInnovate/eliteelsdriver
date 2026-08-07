-- =============================================
-- RIDES TABLE — simplified for passenger app
-- Run this FIRST in Supabase SQL Editor
-- =============================================

-- Status enum
DO $$ BEGIN
  CREATE TYPE ride_status AS ENUM (
    'pending', 'scheduled', 'dispatched', 'en_route',
    'arrived', 'in_progress', 'completed', 'cancelled', 'no_drivers'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS rides (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  passenger_id         UUID NOT NULL REFERENCES auth.users(id),
  driver_id            UUID,
  driver_name          TEXT,
  driver_phone         TEXT,

  status               ride_status NOT NULL DEFAULT 'pending',

  pickup_address       TEXT NOT NULL,
  pickup_coords        TEXT,
  dropoff_address      TEXT,
  dropoff_coords       TEXT,
  waypoints            JSONB DEFAULT '[]'::JSONB,

  -- Booking details
  service_type         TEXT, -- by_the_hour, one_way, vip_security
  vehicle_class        TEXT,
  booked_hours         INTEGER,
  base_rate            DECIMAL(10,2),
  security_package_id  TEXT,
  subtotal             DECIMAL(10,2),
  is_antisocial        BOOLEAN DEFAULT false,

  scheduled_at         TIMESTAMPTZ,
  started_at           TIMESTAMPTZ,
  completed_at         TIMESTAMPTZ,

  corporate_account_id UUID,
  metadata             JSONB DEFAULT '{}'::JSONB,

  total_mileage        DECIMAL(10,2) DEFAULT 0.00,
  total_waiting_time_mins INTEGER DEFAULT 0,
  final_calculated_price  DECIMAL(10,2),

  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_rides_status ON rides(status);
CREATE INDEX IF NOT EXISTS idx_rides_passenger ON rides(passenger_id);
CREATE INDEX IF NOT EXISTS idx_rides_scheduled ON rides(scheduled_at) WHERE scheduled_at IS NOT NULL;

-- RLS
ALTER TABLE rides ENABLE ROW LEVEL SECURITY;

-- Passengers can see their own rides
CREATE POLICY "Passengers can read own rides"
  ON rides FOR SELECT USING (passenger_id = auth.uid());

-- Passengers can create rides
CREATE POLICY "Passengers can create rides"
  ON rides FOR INSERT WITH CHECK (passenger_id = auth.uid());

-- Passengers can update their own rides (cancel etc)
CREATE POLICY "Passengers can update own rides"
  ON rides FOR UPDATE USING (passenger_id = auth.uid());

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_rides_timestamp()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_rides_updated ON rides;
CREATE TRIGGER trg_rides_updated
  BEFORE UPDATE ON rides
  FOR EACH ROW EXECUTE FUNCTION update_rides_timestamp();

-- Enable Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE rides;


-- =============================================
-- RIDE MESSAGES — real-time in-app chat
-- =============================================

CREATE TABLE IF NOT EXISTS ride_messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  ride_id UUID NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES auth.users(id),
  sender_role TEXT NOT NULL CHECK (sender_role IN ('passenger', 'driver')),
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ride_messages_ride ON ride_messages(ride_id, created_at);

ALTER TABLE ride_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Passengers can read own ride messages"
  ON ride_messages FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM rides WHERE rides.id = ride_messages.ride_id AND rides.passenger_id = auth.uid())
  );

CREATE POLICY "Passengers can send messages on own rides"
  ON ride_messages FOR INSERT
  WITH CHECK (
    sender_id = auth.uid() AND
    sender_role = 'passenger' AND
    EXISTS (SELECT 1 FROM rides WHERE rides.id = ride_messages.ride_id AND rides.passenger_id = auth.uid())
  );

CREATE POLICY "Drivers can read assigned ride messages"
  ON ride_messages FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM rides WHERE rides.id = ride_messages.ride_id AND rides.driver_id = auth.uid())
  );

CREATE POLICY "Drivers can send messages on assigned rides"
  ON ride_messages FOR INSERT
  WITH CHECK (
    sender_id = auth.uid() AND
    sender_role = 'driver' AND
    EXISTS (SELECT 1 FROM rides WHERE rides.id = ride_messages.ride_id AND rides.driver_id = auth.uid())
  );

ALTER PUBLICATION supabase_realtime ADD TABLE ride_messages;
