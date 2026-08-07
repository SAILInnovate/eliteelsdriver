ALTER TABLE ride_messages ADD COLUMN IF NOT EXISTS is_read BOOLEAN DEFAULT FALSE;

-- Allow users to update messages for rides they are part of
CREATE POLICY "Users can update ride messages"
  ON ride_messages FOR UPDATE
  USING (
    EXISTS (SELECT 1 FROM rides WHERE rides.id = ride_messages.ride_id AND (rides.passenger_id = auth.uid() OR rides.driver_id = auth.uid()))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM rides WHERE rides.id = ride_messages.ride_id AND (rides.passenger_id = auth.uid() OR rides.driver_id = auth.uid()))
  );
