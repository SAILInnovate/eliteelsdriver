ALTER TABLE ride_messages ADD COLUMN IF NOT EXISTS is_read BOOLEAN DEFAULT FALSE;

CREATE POLICY "Users can update own received messages as read"
  ON ride_messages FOR UPDATE
  USING (sender_id != auth.uid())
  WITH CHECK (sender_id != auth.uid());
