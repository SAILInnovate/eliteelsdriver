-- =====================================================================
-- DRIVER ONBOARDING + DISPATCH-ONLY MODEL
-- Run in Supabase SQL Editor (shared by driver app, client app, admin dashboard)
--
-- 1. driver_profiles — self-serve owner-driver applications, ELS plate
--    issuance, driving profile. Drivers apply in-app; ops approve and
--    issue an ELS plate from the admin dashboard (service role).
-- 2. Dispatch-only rides — drivers can no longer browse or claim
--    pending jobs. Ops assign jobs (sets driver_id + status='dispatched');
--    drivers only see/update rides assigned to them.
-- =====================================================================

-- =============================================
-- 1. DRIVER PROFILES
-- =============================================

CREATE TABLE IF NOT EXISTS public.driver_profiles (
  user_id            UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name          TEXT,
  phone              TEXT,

  -- Application lifecycle: pending_review -> approved (or suspended)
  -- Only the admin dashboard (service role) may change this.
  status             TEXT NOT NULL DEFAULT 'pending_review'
                     CHECK (status IN ('pending_review', 'approved', 'suspended')),

  -- Owner-driver vehicle details (driver brings their own car)
  owns_vehicle       BOOLEAN NOT NULL DEFAULT false,
  vehicle_reg        TEXT,        -- their current private plate
  vehicle_make_model TEXT,
  vehicle_colour     TEXT,

  -- ELS plate issued by ops once approved (admin dashboard only)
  els_plate          TEXT UNIQUE,
  els_plate_issued_at TIMESTAMPTZ,

  -- Driving profile — maintained by ops from logged data; company pays
  -- accordingly outside the app. The app only displays it.
  driving_score      NUMERIC,
  admin_notes        TEXT,

  metadata           JSONB DEFAULT '{}'::JSONB,
  applied_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_at        TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.driver_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Drivers can read own profile" ON public.driver_profiles;
CREATE POLICY "Drivers can read own profile" ON public.driver_profiles
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Drivers can apply" ON public.driver_profiles;
CREATE POLICY "Drivers can apply" ON public.driver_profiles
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Drivers can update own profile" ON public.driver_profiles;
CREATE POLICY "Drivers can update own profile" ON public.driver_profiles
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Drivers may edit their own details but can NEVER set ops-owned fields
-- (status, ELS plate, driving score). Service role (admin dashboard)
-- bypasses RLS and has auth.uid() = NULL, so it is unaffected.
CREATE OR REPLACE FUNCTION public.protect_driver_profile_columns()
RETURNS TRIGGER AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() = NEW.user_id THEN
    IF TG_OP = 'INSERT' THEN
      NEW.status := 'pending_review';
      NEW.els_plate := NULL;
      NEW.els_plate_issued_at := NULL;
      NEW.driving_score := NULL;
      NEW.admin_notes := NULL;
      NEW.approved_at := NULL;
    ELSE
      NEW.status := OLD.status;
      NEW.els_plate := OLD.els_plate;
      NEW.els_plate_issued_at := OLD.els_plate_issued_at;
      NEW.driving_score := OLD.driving_score;
      NEW.admin_notes := OLD.admin_notes;
      NEW.approved_at := OLD.approved_at;
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_protect_driver_profile ON public.driver_profiles;
CREATE TRIGGER trg_protect_driver_profile
  BEFORE INSERT OR UPDATE ON public.driver_profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_driver_profile_columns();

-- Realtime so the app sees approval / ELS plate issuance instantly
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.driver_profiles;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Backfill: existing drivers (anyone who has worked a shift or uploaded
-- documents) are already vetted — mark them approved so they are not
-- locked out by the new application gate.
DO $$
BEGIN
  IF to_regclass('public.driver_shifts') IS NOT NULL THEN
    INSERT INTO public.driver_profiles (user_id, full_name, phone, status, approved_at)
    SELECT DISTINCT u.id, u.raw_user_meta_data->>'full_name', u.phone, 'approved', now()
    FROM auth.users u
    JOIN public.driver_shifts s ON s.driver_id = u.id
    ON CONFLICT (user_id) DO NOTHING;
  END IF;

  IF to_regclass('public.driver_documents') IS NOT NULL THEN
    INSERT INTO public.driver_profiles (user_id, full_name, phone, status, approved_at)
    SELECT DISTINCT u.id, u.raw_user_meta_data->>'full_name', u.phone, 'approved', now()
    FROM auth.users u
    JOIN public.driver_documents d ON d.driver_id = u.id
    ON CONFLICT (user_id) DO NOTHING;
  END IF;
END $$;

-- =============================================
-- 2. DISPATCH-ONLY RIDES (no accept / decline)
-- =============================================

-- Drivers no longer browse or claim the pending pool
DROP POLICY IF EXISTS "Drivers can read pending rides" ON public.rides;
DROP POLICY IF EXISTS "Drivers can claim pending rides" ON public.rides;

-- Drivers see and update only rides assigned to them by ops
DROP POLICY IF EXISTS "Drivers can read assigned rides" ON public.rides;
CREATE POLICY "Drivers can read assigned rides" ON public.rides
  FOR SELECT USING (auth.uid() = driver_id);

DROP POLICY IF EXISTS "Drivers can update assigned rides" ON public.rides;
CREATE POLICY "Drivers can update assigned rides" ON public.rides
  FOR UPDATE USING (auth.uid() = driver_id) WITH CHECK (auth.uid() = driver_id);

-- Log when ops assigned the job (admin dashboard sets this on dispatch)
ALTER TABLE public.rides ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ;
-- Log when the driver's app acknowledged the assignment
ALTER TABLE public.rides ADD COLUMN IF NOT EXISTS acknowledged_at TIMESTAMPTZ;

-- Stamp assigned_at automatically whenever a driver is attached to a ride
CREATE OR REPLACE FUNCTION public.stamp_ride_assignment()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.driver_id IS NOT NULL AND (OLD.driver_id IS DISTINCT FROM NEW.driver_id) THEN
    NEW.assigned_at := now();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_stamp_ride_assignment ON public.rides;
CREATE TRIGGER trg_stamp_ride_assignment
  BEFORE UPDATE ON public.rides
  FOR EACH ROW EXECUTE FUNCTION public.stamp_ride_assignment();
