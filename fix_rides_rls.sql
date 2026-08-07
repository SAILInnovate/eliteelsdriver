-- Fix RLS policy for rides table
-- Passengers need to INSERT their own rides and SELECT their own rides

-- Drop existing policies if they exist (safe to run multiple times)
DO $$
BEGIN
  DROP POLICY IF EXISTS "Passengers can insert own rides" ON rides;
  DROP POLICY IF EXISTS "Passengers can read own rides" ON rides;
  DROP POLICY IF EXISTS "Passengers can update own rides" ON rides;
  DROP POLICY IF EXISTS "Drivers can read assigned rides" ON rides;
  DROP POLICY IF EXISTS "Drivers can update assigned rides" ON rides;
END $$;

-- Enable RLS
ALTER TABLE rides ENABLE ROW LEVEL SECURITY;

-- Passengers can create their own rides
CREATE POLICY "Passengers can insert own rides" ON rides
  FOR INSERT WITH CHECK (auth.uid() = passenger_id);

-- Passengers can read their own rides
CREATE POLICY "Passengers can read own rides" ON rides
  FOR SELECT USING (auth.uid() = passenger_id);

-- Passengers can update their own rides (cancel, etc)
CREATE POLICY "Passengers can update own rides" ON rides
  FOR UPDATE USING (auth.uid() = passenger_id);

-- Drivers can read rides assigned to them
CREATE POLICY "Drivers can read assigned rides" ON rides
  FOR SELECT USING (auth.uid() = driver_id);

-- Drivers can update rides assigned to them (status changes)
CREATE POLICY "Drivers can update assigned rides" ON rides
  FOR UPDATE USING (auth.uid() = driver_id);

-- Club/corporate admins can see all rides for their organisation
-- (requires the user to be linked to the same corporate_account via passenger_profiles)
CREATE POLICY "Club admins can read org rides" ON rides
  FOR SELECT USING (
    corporate_account_id IN (
      SELECT pp.corporate_account_id FROM passenger_profiles pp
      JOIN global_users gu ON gu.id = pp.user_id
      WHERE pp.user_id = auth.uid() AND gu.role = 'admin'
    )
  );
