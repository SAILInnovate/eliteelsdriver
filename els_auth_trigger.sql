-- =============================================
-- FIX: Auth trigger for new user signup
-- =============================================
-- Run this in Supabase SQL Editor to replace
-- the previous trigger that was blocking signups.

-- Drop the broken trigger first
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS handle_new_user();

-- Recreate with explicit RLS bypass
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  -- Insert into global_users (bypass RLS via SECURITY DEFINER)
  INSERT INTO public.global_users (id, phone_number, role, created_at)
  VALUES (
    NEW.id,
    COALESCE(NEW.phone, ''),
    'passenger',
    NOW()
  )
  ON CONFLICT (id) DO NOTHING;

  -- Insert blank passenger_profile
  INSERT INTO public.passenger_profiles (user_id, full_name, tier, available_credits, preferences)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    'everyday',
    0.00,
    '{}'::JSONB
  )
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    -- Log but don't block signup
    RAISE WARNING 'handle_new_user trigger failed: %', SQLERRM;
    RETURN NEW;
END;
$$;

-- Re-attach trigger
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION handle_new_user();
