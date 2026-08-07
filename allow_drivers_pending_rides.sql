-- Fix RLS policy to allow drivers to see and accept pending requests

-- 1. Allow drivers to read ANY pending rides
DROP POLICY IF EXISTS "Drivers can read pending rides" ON rides;
CREATE POLICY "Drivers can read pending rides" ON rides
  FOR SELECT USING (
    status IN ('pending', 'scheduled')
  );

-- 2. Allow drivers to UPDATE pending rides so they can assign themselves to it
DROP POLICY IF EXISTS "Drivers can claim pending rides" ON rides;
CREATE POLICY "Drivers can claim pending rides" ON rides
  FOR UPDATE USING (
    status = 'pending' AND driver_id IS NULL
  )
  WITH CHECK (
    auth.uid() = driver_id
  );
