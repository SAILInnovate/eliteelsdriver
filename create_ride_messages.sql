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

-- Index for fast per-ride queries
CREATE INDEX IF NOT EXISTS idx_ride_messages_ride ON ride_messages(ride_id, created_at);

-- RLS
ALTER TABLE ride_messages ENABLE ROW LEVEL SECURITY;

-- Passengers can read/write messages for their own rides
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

-- Drivers can read/write messages for rides assigned to them
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

-- Enable Realtime for this table
ALTER PUBLICATION supabase_realtime ADD TABLE ride_messages;
