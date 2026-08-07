-- Safe migration: passenger_tier → silver/gold/platinum
-- Run ONLY this file in Supabase SQL Editor (NOT els_platform_schema.sql)

DO $$
BEGIN
  -- Check if the old enum values exist
  IF EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'everyday' AND enumtypid = 'passenger_tier'::regtype) THEN
    -- Old enum exists — do the full migration
    ALTER TYPE passenger_tier RENAME TO passenger_tier_old;
    CREATE TYPE passenger_tier AS ENUM ('silver', 'gold', 'platinum');
    ALTER TABLE passenger_profiles 
      ALTER COLUMN tier DROP DEFAULT,
      ALTER COLUMN tier TYPE passenger_tier 
        USING CASE 
          WHEN tier::text = 'everyday' THEN 'silver'::passenger_tier
          WHEN tier::text = 'premium_idol' THEN 'platinum'::passenger_tier
          ELSE 'silver'::passenger_tier
        END,
      ALTER COLUMN tier SET DEFAULT 'silver';
    DROP TYPE passenger_tier_old;
    RAISE NOTICE 'Migrated passenger_tier from everyday/premium_idol to silver/gold/platinum';
  ELSIF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'passenger_tier') THEN
    -- Enum doesn't exist at all — create it fresh
    CREATE TYPE passenger_tier AS ENUM ('silver', 'gold', 'platinum');
    RAISE NOTICE 'Created passenger_tier enum (silver/gold/platinum)';
  ELSE
    RAISE NOTICE 'passenger_tier already has the correct values — no changes needed';
  END IF;
END $$;
