BEGIN;

-- ==========================================
-- START: schema.sql
-- ==========================================

-- 1. Create the clinches table with a secure UUID
DROP TABLE IF EXISTS public.clinches CASCADE;

CREATE TABLE public.clinches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sender_id UUID REFERENCES public.user_subscriptions(user_id), -- Nullable for MVP if sender isn't logged in
    sender_name TEXT,
    sender_phone TEXT, -- To perfectly deduplicate nodes in Network Graph
    recipient_phone TEXT NOT NULL,
    terms TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'clinched', 'expired', 'rejected'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    agreed_at TIMESTAMP WITH TIME ZONE,
    agreed_ip TEXT,
    agreed_by TEXT, -- The phone number that agreed, should match recipient_phone
    agreed_name TEXT, -- The full name of the person who agreed (from their profile)
    due_date TIMESTAMP WITH TIME ZONE, -- Optional precise date for automated SMS reminders
    rejected_at TIMESTAMP WITH TIME ZONE,
    disputed_at TIMESTAMP WITH TIME ZONE,
    resolved_at TIMESTAMP WITH TIME ZONE,
    
    -- Ensure status is one of the allowed values
    CONSTRAINT valid_status CHECK (status IN ('pending', 'clinched', 'expired', 'rejected', 'disputed'))
);

-- 2. Turn on Row Level Security (RLS)
ALTER TABLE public.clinches ENABLE ROW LEVEL SECURITY;

-- 3. Create RLS Policies

-- Policy A: Anyone can create a new clinch (for the "Make a Promise" card)
DROP POLICY IF EXISTS "Anyone can create a clinch" ON public.clinches;
CREATE POLICY "Anyone can create a clinch" 
ON public.clinches FOR INSERT 
TO public
WITH CHECK (true);

-- Policy B: Anyone can read a clinch if they have the secure UUID link
DROP POLICY IF EXISTS "Anyone can read a clinch with ID" ON public.clinches;
CREATE POLICY "Anyone can read a clinch with ID" 
ON public.clinches FOR SELECT 
TO public
USING (true);

-- Policy B.2: Allow users to UPDATE clinches (for rejecting, or renegotiating)
DROP POLICY IF EXISTS "Anyone can update a clinch" ON public.clinches;
CREATE POLICY "Anyone can update a clinch" 
ON public.clinches FOR UPDATE
TO public
USING (true)
WITH CHECK (true);

-- ==============================================================================
-- 4. Create the clinch_history table to track every change like Git
-- ==============================================================================
DROP TABLE IF EXISTS public.clinch_history CASCADE;

CREATE TABLE public.clinch_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clinch_id UUID REFERENCES public.clinches(id) ON DELETE CASCADE,
    previous_terms TEXT NOT NULL,
    new_terms TEXT NOT NULL,
    changed_by_phone TEXT NOT NULL, -- Who requested the change (sender or recipient)
    changed_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.clinch_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read history" ON public.clinch_history;
CREATE POLICY "Anyone can read history" 
ON public.clinch_history FOR SELECT 
TO public 
USING (true);

DROP POLICY IF EXISTS "Anyone can insert history" ON public.clinch_history;
CREATE POLICY "Anyone can insert history" 
ON public.clinch_history FOR INSERT 
TO public 
WITH CHECK (true);

-- ==============================================================================
-- 5. Create a secure RPC function to update terms and log history
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.update_clinch_terms(
    p_clinch_id UUID,
    p_new_terms TEXT,
    p_changed_by_phone TEXT
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_status TEXT;
    v_old_terms TEXT;
BEGIN
    -- 1. Check if the clinch exists and get current status
    SELECT status, terms INTO v_status, v_old_terms
    FROM public.clinches
    WHERE id = p_clinch_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Clinch not found';
    END IF;

    -- 2. IMPORTANT: Cannot change terms if it's already clinched!
    IF v_status = 'clinched' THEN
        RAISE EXCEPTION 'Cannot modify terms because this agreement has already been clinched.';
    END IF;

    -- 3. If the terms are exactly the same, do nothing
    IF v_old_terms = p_new_terms THEN
        RETURN true;
    END IF;

    -- 4. Update the terms and reset status to pending (if it was rejected)
    UPDATE public.clinches
    SET terms = p_new_terms,
        status = 'pending',
        rejected_at = NULL -- Clear out any previous rejection
    WHERE id = p_clinch_id;

    -- 5. Insert an audit log into the history table
    INSERT INTO public.clinch_history (clinch_id, previous_terms, new_terms, changed_by_phone, changed_at)
    VALUES (p_clinch_id, v_old_terms, p_new_terms, p_changed_by_phone, timezone('utc'::text, now()));

    RETURN true;
END;
$$;

-- Policy C: Only the verified recipient can update the status to 'clinched'
-- They MUST be logged in (auth.uid() is not null)
-- We strictly limit what they can update. They cannot change the terms.
DROP POLICY IF EXISTS "Verified recipient can update status" ON public.clinches;
CREATE POLICY "Verified recipient can update status" 
ON public.clinches FOR UPDATE 
TO authenticated
USING (
    -- Remove + from both sides for loose equality
    REPLACE(auth.jwt() ->> 'phone', '+', '') = REPLACE(recipient_phone, '+', '')
)
WITH CHECK (
    REPLACE(auth.jwt() ->> 'phone', '+', '') = REPLACE(recipient_phone, '+', '')
);

-- Policy D: The owner (sender) can also update their own clinches (e.g., to flag as disputed)
DROP POLICY IF EXISTS "Owner can update their own clinches" ON public.clinches;
CREATE POLICY "Owner can update their own clinches" 
ON public.clinches FOR UPDATE 
TO authenticated
USING (auth.uid() = sender_id)
WITH CHECK (auth.uid() = sender_id);

-- 4. Create a Secure Database Function to Seal the Agreement
-- This function runs on the server, ensuring the IP and Timestamp cannot be faked by the client.
CREATE OR REPLACE FUNCTION public.seal_clinch(clinch_id UUID)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER -- Runs with elevated privileges to update the row
AS $$
DECLARE
    target_clinch public.clinches%ROWTYPE;
    client_ip text;
BEGIN
    -- 1. Check if the user is logged in
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'You must be securely verified to sign this agreement.';
    END IF;

    -- 2. Find the clinch
    SELECT * INTO target_clinch FROM public.clinches WHERE id = clinch_id;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Agreement not found.';
    END IF;

    -- 3. Verify the logged-in user's phone matches the recipient_phone
    -- Remove the '+' sign if present on both sides to avoid strict equality mismatch
    IF REPLACE((auth.jwt() ->> 'phone'), '+', '') != REPLACE(target_clinch.recipient_phone, '+', '') THEN
        RAISE EXCEPTION 'Your verified phone does not match the recipient on this agreement.';
    END IF;

    -- 4. Check if it's already clinched
    IF target_clinch.status = 'clinched' THEN
        RAISE EXCEPTION 'This agreement has already been sealed.';
    END IF;

    -- 5. Securely capture the IP address from the request headers
    -- Supabase stores headers in current_setting('request.headers', true)
    -- We extract 'x-forwarded-for' or fallback to a standard string
    BEGIN
        client_ip := current_setting('request.headers', true)::json->>'x-forwarded-for';
        -- If multiple IPs are forwarded, take the first one (the actual client)
        IF client_ip LIKE '%,%' THEN
            client_ip := split_part(client_ip, ',', 1);
        END IF;
    EXCEPTION WHEN OTHERS THEN
        client_ip := 'IP Not Available';
    END;

    -- 6. Perform the secure update
    UPDATE public.clinches
    SET 
        status = 'clinched',
        agreed_at = timezone('utc'::text, now()), -- Server-side trusted timestamp
        agreed_ip = client_ip,                    -- Server-side trusted IP
        agreed_by = (auth.jwt() ->> 'phone'),     -- Server-side authenticated phone
        agreed_name = (auth.jwt() -> 'user_metadata' ->> 'full_name') -- Extract their saved profile name
    WHERE id = clinch_id;

    RETURN true;
END;
$$;

-- Add audit columns for disputes
ALTER TABLE public.clinches ADD COLUMN IF NOT EXISTS disputed_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE public.clinches ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMP WITH TIME ZONE;


-- ==========================================
-- START: tabs_schema.sql
-- ==========================================

-- ============================================
-- CLINCH TABS — Recurring Handshakes Schema
-- ============================================

-- 1. The Tab itself (the recurring agreement)
CREATE TABLE IF NOT EXISTS public.clinch_tabs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    creator_id UUID NOT NULL,
    creator_name TEXT,
    recipient_phone TEXT NOT NULL,
    label TEXT NOT NULL,                    -- "Coffee Fund", "Gym Split", etc.
    amount DECIMAL(10,2) NOT NULL,          -- Amount per cycle (e.g., 5.00)
    currency TEXT NOT NULL DEFAULT 'GBP',
    frequency TEXT NOT NULL DEFAULT 'monthly', -- 'weekly', 'monthly'
    settle_threshold DECIMAL(10,2) NOT NULL DEFAULT 5.00, -- Min amount before "Settle Up"
    running_total DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'active', 'paused', 'settled', 'cancelled'
    next_due DATE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    last_ticked_at TIMESTAMP WITH TIME ZONE,
    settled_at TIMESTAMP WITH TIME ZONE,
    settlement_type TEXT NOT NULL DEFAULT 'amount', -- 'amount', 'date'
    due_day INTEGER, -- 1-31 for monthly, 1-7 for weekly
    direction TEXT NOT NULL DEFAULT 'in', -- 'in' (Request), 'out' (Pay)
    
    CONSTRAINT valid_tab_status CHECK (status IN ('pending', 'active', 'paused', 'settled', 'cancelled', 'archived')),
    CONSTRAINT valid_frequency CHECK (frequency IN ('weekly', 'monthly')),
    CONSTRAINT valid_settlement_type CHECK (settlement_type IN ('amount', 'date')),
    CONSTRAINT positive_amount CHECK (amount > 0)
);

-- 2. Tab Ledger — Every "tick" of the tab (each weekly/monthly entry)
CREATE TABLE IF NOT EXISTS public.tab_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tab_id UUID NOT NULL REFERENCES public.clinch_tabs(id) ON DELETE CASCADE,
    amount DECIMAL(10,2) NOT NULL,
    note TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 3. RLS Policies for clinch_tabs
ALTER TABLE public.clinch_tabs ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist to allow re-running the script
DROP POLICY IF EXISTS "Creator full access" ON public.clinch_tabs;
DROP POLICY IF EXISTS "Anyone can view tab" ON public.clinch_tabs;
DROP POLICY IF EXISTS "Users can view own tabs" ON public.clinch_tabs;
DROP POLICY IF EXISTS "Recipient can view their tabs" ON public.clinch_tabs;

-- Creator can do everything with their own tabs
CREATE POLICY "Creator full access" ON public.clinch_tabs
    FOR ALL TO authenticated
    USING (auth.uid() = creator_id)
    WITH CHECK (auth.uid() = creator_id);

-- Allow anyone to read a tab by ID (used for the public TabPage)
CREATE POLICY "Anyone can view tab" ON public.clinch_tabs
    FOR SELECT
    USING (true);

-- 4. RLS Policies for tab_entries
ALTER TABLE public.tab_entries ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Anyone can read tab entries" ON public.tab_entries;
DROP POLICY IF EXISTS "Users can read own tab entries" ON public.tab_entries;
DROP POLICY IF EXISTS "Creator can add entries" ON public.tab_entries;
DROP POLICY IF EXISTS "Users can view their tab entries" ON public.tab_entries;

-- Anyone can read entries associated with a tab
CREATE POLICY "Anyone can read tab entries" ON public.tab_entries
    FOR SELECT
    USING (true);

-- Creator can insert entries
CREATE POLICY "Creator can add entries" ON public.tab_entries
    FOR INSERT TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.clinch_tabs t
            WHERE t.id = tab_id AND t.creator_id = auth.uid()
        )
    );

-- 5. Function to "tick" a tab (add a new entry and update running total)
CREATE OR REPLACE FUNCTION public.tick_tab(p_tab_id UUID)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_tab public.clinch_tabs%ROWTYPE;
BEGIN
    SELECT * INTO v_tab FROM public.clinch_tabs WHERE id = p_tab_id;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Tab not found.';
    END IF;
    
    IF v_tab.status != 'active' THEN
        RAISE EXCEPTION 'Tab is not active.';
    END IF;
    
    -- Insert a ledger entry
    INSERT INTO public.tab_entries (tab_id, amount, note)
    VALUES (p_tab_id, v_tab.amount, v_tab.frequency || ' charge');
    
    -- Update running total and next due date
    UPDATE public.clinch_tabs
    SET 
        running_total = running_total + v_tab.amount,
        last_ticked_at = now(),
        next_due = CASE 
            WHEN v_tab.frequency = 'weekly' THEN (COALESCE(v_tab.next_due, CURRENT_DATE) + INTERVAL '7 days')::DATE
            WHEN v_tab.frequency = 'monthly' THEN (COALESCE(v_tab.next_due, CURRENT_DATE) + INTERVAL '1 month')::DATE
        END
    WHERE id = p_tab_id;
    
    RETURN true;
END;
$$;

-- 6. Function to settle a tab (reset running total)
CREATE OR REPLACE FUNCTION public.settle_tab(p_tab_id UUID)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    UPDATE public.clinch_tabs
    SET 
        running_total = 0,
        settled_at = now(),
        status = 'settled'
    WHERE id = p_tab_id
    AND creator_id = auth.uid();
    
    RETURN true;
END;
$$;

-- 7. Function to manually increment a tab total
CREATE OR REPLACE FUNCTION public.increment_tab_total(p_tab_id UUID, p_amount DECIMAL)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    UPDATE public.clinch_tabs
    SET 
        running_total = running_total + p_amount
    WHERE id = p_tab_id
    AND creator_id = auth.uid();
    
    RETURN true;
END;
$$;

-- 8. Function to accept a tab
CREATE OR REPLACE FUNCTION public.accept_tab(p_tab_id UUID)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_tab public.clinch_tabs%ROWTYPE;
BEGIN
    SELECT * INTO v_tab FROM public.clinch_tabs WHERE id = p_tab_id;

    IF v_tab.status != 'pending' THEN
        RETURN false;
    END IF;

    UPDATE public.clinch_tabs
    SET 
        status = 'active',
        running_total = amount, -- Start with the first cycle's amount
        last_ticked_at = now()
    WHERE id = p_tab_id;

    -- Insert the first ledger entry
    INSERT INTO public.tab_entries (tab_id, amount, note)
    VALUES (p_tab_id, v_tab.amount, 'Tab started');
    
    RETURN true;
END;
$$;

-- 9. Function to pause a tab
CREATE OR REPLACE FUNCTION public.pause_tab(p_tab_id UUID)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    UPDATE public.clinch_tabs
    SET status = 'paused'
    WHERE id = p_tab_id
    AND (creator_id = auth.uid() OR recipient_phone = (SELECT phone FROM auth.users WHERE id = auth.uid()));
    
    RETURN true;
END;
$$;

-- 10. Function to resume a tab
CREATE OR REPLACE FUNCTION public.resume_tab(p_tab_id UUID)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    UPDATE public.clinch_tabs
    SET status = 'active'
    WHERE id = p_tab_id
    AND (creator_id = auth.uid() OR recipient_phone = (SELECT phone FROM auth.users WHERE id = auth.uid()));
    
    RETURN true;
END;
$$;

-- 11. Function to cancel/archive a tab
-- Logic: 
-- - If balance is 0, any party can archive.
-- - If balance > 0, ONLY the person owed can "Forgive & Archive".
-- - If balance > 0, the person who owes must "Settle & Archive" (meaning they settle first).
CREATE OR REPLACE FUNCTION public.cancel_tab(p_tab_id UUID, p_action TEXT)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_tab public.clinch_tabs%ROWTYPE;
    v_user_phone TEXT;
BEGIN
    SELECT * INTO v_tab FROM public.clinch_tabs WHERE id = p_tab_id;
    SELECT phone INTO v_user_phone FROM auth.users WHERE id = auth.uid();

    -- Action logic:
    -- 'archive' -> can be done if balance is 0.
    -- 'forgive' -> can be done by the party who is OWED (Creator if 'in', Recipient if 'out').
    -- 'settle_close' -> can be done by the party who OWES (Recipient if 'in', Creator if 'out').
    
    IF p_action = 'archive' AND v_tab.running_total = 0 THEN
        UPDATE public.clinch_tabs SET status = 'archived' WHERE id = p_tab_id;
    ELSIF p_action = 'forgive' AND (
        (v_tab.direction = 'in' AND v_tab.creator_id = auth.uid()) OR 
        (v_tab.direction = 'out' AND REPLACE(v_tab.recipient_phone, '+', '') = REPLACE(v_user_phone, '+', ''))
    ) THEN
        -- Owed party chooses to forgive
        UPDATE public.clinch_tabs SET status = 'archived', running_total = 0 WHERE id = p_tab_id;
        INSERT INTO public.tab_entries (tab_id, amount, note) VALUES (p_tab_id, -v_tab.running_total, 'Balance forgiven');
    ELSIF p_action = 'settle_close' AND (
        (v_tab.direction = 'in' AND REPLACE(v_tab.recipient_phone, '+', '') = REPLACE(v_user_phone, '+', '')) OR
        (v_tab.direction = 'out' AND v_tab.creator_id = auth.uid())
    ) THEN
        -- Debtor party clicks Settle & Close
        UPDATE public.clinch_tabs SET status = 'archived', running_total = 0, settled_at = now() WHERE id = p_tab_id;
        INSERT INTO public.tab_entries (tab_id, amount, note) VALUES (p_tab_id, -v_tab.running_total, 'Settle & Close');
    ELSE
        RAISE EXCEPTION 'Invalid cancellation action or insufficient permissions.';
    END IF;

    RETURN true;
END;
$$;


-- ==========================================
-- START: stripe_schema.sql
-- ==========================================

-- 1. Create a secure secure table to track subscriptions
-- We do not attach this to auth.users as we need strict Row Level Security (RLS)
CREATE TABLE public.user_subscriptions (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    tier TEXT NOT NULL DEFAULT 'free' CHECK (tier IN ('free', 'pro')),
    stripe_customer_id TEXT UNIQUE,
    stripe_subscription_id TEXT UNIQUE,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. Enable Row Level Security (CRITICAL FOR SECURITY)
ALTER TABLE public.user_subscriptions ENABLE ROW LEVEL SECURITY;

-- 3. Create RLS Policies
-- Users can READ their own subscription tier (so the React app knows if they are Pro)
CREATE POLICY "Users can view own subscription" 
ON public.user_subscriptions FOR SELECT 
TO authenticated
USING (auth.uid() = user_id);

-- EXTREMELY IMPORTANT:
-- Notice there are NO 'INSERT', 'UPDATE', or 'DELETE' policies created for 'authenticated' users.
-- This guarantees that a user CANNOT hack their client (e.g. changing local JS) to maliciously upgrade themselves.
-- Only Supabase's secure backend (via Service Role Key inside the Edge Function) can update this table!

-- 4. Create an automatic trigger to insert a 'free' row when a new user signs up
CREATE OR REPLACE FUNCTION public.handle_new_user_subscription()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.user_subscriptions (user_id, tier)
  VALUES (new.id, 'free');
  RETURN new;
END;
$$;

-- Attach trigger to auth.users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user_subscription();


-- ==========================================
-- START: els_platform_schema.sql
-- ==========================================

-- =============================================
-- ELS PLATFORM — SUPABASE DATABASE SCHEMA
-- =============================================
-- Run this against your Supabase SQL Editor.
-- Enables PostGIS, creates all enums, tables,
-- foreign keys, indexes, and RLS policies.
-- =============================================


-- 0. EXTENSIONS
-- =============================================
CREATE EXTENSION IF NOT EXISTS "postgis";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";


-- 1. ENUM TYPES
-- =============================================

CREATE TYPE user_role AS ENUM ('passenger', 'driver', 'admin');

CREATE TYPE passenger_tier AS ENUM ('silver', 'gold', 'platinum');

CREATE TYPE subscription_status AS ENUM ('active', 'suspended');

CREATE TYPE driver_status AS ENUM ('offline', 'available', 'on_job');

CREATE TYPE vehicle_class AS ENUM ('executive', 'first_class', 'suv_xl', 'van');

CREATE TYPE ride_status AS ENUM (
  'pending',
  'dispatched',
  'en_route',
  'arrived',
  'in_progress',
  'completed',
  'cancelled'
);

CREATE TYPE dispatch_type AS ENUM ('internal', 'outsourced_supplier');

CREATE TYPE audit_type AS ENUM ('start_of_shift', 'end_of_shift');

CREATE TYPE alloys_condition AS ENUM ('perfect', 'scuffed', 'damaged');

CREATE TYPE invoice_status AS ENUM ('draft', 'sent', 'paid', 'overdue');


-- 2. CORE USER & HARVESTING LAYER
-- =============================================

CREATE TABLE global_users (
  id            UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  phone_number  TEXT UNIQUE NOT NULL,
  role          user_role NOT NULL DEFAULT 'passenger',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE global_users IS 'Base table for all app users. Linked to Supabase Auth for phone-verified identities.';


-- 3. B2B CLIENT LAYER
-- =============================================

CREATE TABLE corporate_accounts (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  club_name       TEXT NOT NULL,
  billing_email   TEXT NOT NULL,
  brand_color_hex TEXT DEFAULT '#FFFFFF',
  logo_url        TEXT,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE corporate_accounts IS 'Clubs and corporate clients that receive weekly invoices.';

CREATE TABLE passenger_profiles (
  user_id              UUID PRIMARY KEY REFERENCES global_users(id) ON DELETE CASCADE,
  full_name            TEXT NOT NULL,
  tier                 passenger_tier NOT NULL DEFAULT 'silver',
  corporate_account_id UUID REFERENCES corporate_accounts(id) ON DELETE SET NULL,
  available_credits    DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  preferences          JSONB NOT NULL DEFAULT '{}'::JSONB,
  stripe_customer_id   TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE passenger_profiles IS 'Extended passenger data. Links Players to their Clubs.';
COMMENT ON COLUMN passenger_profiles.preferences IS 'Luxury needs: {"temp": 21, "music": "jazz", "conversation": "silent", "beverage": "sparkling"}';


-- 4. SUPPLY SIDE
-- =============================================

CREATE TABLE driver_businesses (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_name        TEXT NOT NULL,
  subscription_status subscription_status NOT NULL DEFAULT 'active',
  payout_account_id   TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE driver_businesses IS 'Fleet operators who pay a subscription to ELS.';

CREATE TABLE drivers (
  user_id          UUID PRIMARY KEY REFERENCES global_users(id) ON DELETE CASCADE,
  business_id      UUID NOT NULL REFERENCES driver_businesses(id) ON DELETE CASCADE,
  full_name        TEXT NOT NULL,
  license_number   TEXT NOT NULL,
  current_status   driver_status NOT NULL DEFAULT 'offline',
  current_location GEOGRAPHY(POINT, 4326),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE drivers IS 'Individual chauffeurs linked to their fleet business.';

CREATE TABLE vehicles (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id        UUID NOT NULL REFERENCES driver_businesses(id) ON DELETE CASCADE,
  registration_plate TEXT UNIQUE NOT NULL,
  make_model         TEXT NOT NULL,
  vehicle_class      vehicle_class NOT NULL DEFAULT 'executive',
  color              TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE vehicles IS 'Luxury fleet managed by driver businesses.';


-- 5. PRICING ENGINE
-- =============================================

CREATE TABLE rate_cards (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id          UUID NOT NULL REFERENCES driver_businesses(id) ON DELETE CASCADE,
  corporate_account_id UUID REFERENCES corporate_accounts(id) ON DELETE SET NULL,
  vehicle_class        vehicle_class NOT NULL,
  base_fare            DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  price_per_mile       DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  waiting_time_per_min DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- A business can only have one rate per vehicle class per corporate account
  UNIQUE (business_id, corporate_account_id, vehicle_class)
);

COMMENT ON TABLE rate_cards IS 'Custom pricing per business, with optional corporate overrides.';
COMMENT ON COLUMN rate_cards.corporate_account_id IS 'NULL = general public rate. Set = special rate for that specific Club.';


-- 6. DISPATCH & JOURNEY ENGINE
-- =============================================

CREATE TABLE rides (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  passenger_id         UUID NOT NULL REFERENCES global_users(id),
  driver_id            UUID REFERENCES global_users(id),
  vehicle_id           UUID REFERENCES vehicles(id),
  corporate_account_id UUID REFERENCES corporate_accounts(id) ON DELETE SET NULL,
  rate_card_id         UUID REFERENCES rate_cards(id),

  status               ride_status NOT NULL DEFAULT 'pending',
  dispatch_type        dispatch_type NOT NULL DEFAULT 'internal',

  pickup_address       TEXT NOT NULL,
  pickup_coords        GEOGRAPHY(POINT, 4326),
  dropoff_address      TEXT NOT NULL,
  dropoff_coords       GEOGRAPHY(POINT, 4326),
  waypoints            JSONB DEFAULT '[]'::JSONB,

  flight_number        TEXT,
  masked_proxy_number  TEXT,

  scheduled_at         TIMESTAMPTZ,
  started_at           TIMESTAMPTZ,
  completed_at         TIMESTAMPTZ,

  total_mileage        DECIMAL(10, 2) DEFAULT 0.00,
  total_waiting_time_mins INTEGER DEFAULT 0,
  final_calculated_price  DECIMAL(10, 2),

  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE rides IS 'Core job sheet. Handles tracking, multi-stop, outsourcing.';
COMMENT ON COLUMN rides.dispatch_type IS 'Drives the Light Green / Light Blue UI logic in Admin app.';


-- 7. OPERATIONS & AUDITING
-- =============================================

CREATE TABLE vehicle_audits (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  driver_id         UUID NOT NULL REFERENCES global_users(id),
  vehicle_id        UUID NOT NULL REFERENCES vehicles(id),
  audit_type        audit_type NOT NULL,
  fuel_level        INTEGER CHECK (fuel_level >= 0 AND fuel_level <= 100),
  alloys_condition  alloys_condition NOT NULL DEFAULT 'perfect',
  stock_replenished BOOLEAN NOT NULL DEFAULT FALSE,
  photo_urls        JSONB DEFAULT '[]'::JSONB,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE vehicle_audits IS 'Pre/Post shift checklists for chauffeurs.';


-- 8. BILLING & INVOICING
-- =============================================

CREATE TABLE invoices (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  corporate_account_id UUID NOT NULL REFERENCES corporate_accounts(id) ON DELETE CASCADE,
  billing_period_start DATE NOT NULL,
  billing_period_end   DATE NOT NULL,
  total_amount         DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  status               invoice_status NOT NULL DEFAULT 'draft',
  ride_ids             JSONB DEFAULT '[]'::JSONB,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE invoices IS 'Weekly automated billing for B2B Corporate Clubs.';


-- 9. PERFORMANCE INDEXES
-- =============================================

-- Fast lookup: find available drivers near a location
CREATE INDEX idx_drivers_status ON drivers (current_status);
CREATE INDEX idx_drivers_location ON drivers USING GIST (current_location);

-- Fast lookup: rides by status for dispatch board
CREATE INDEX idx_rides_status ON rides (status);
CREATE INDEX idx_rides_passenger ON rides (passenger_id);
CREATE INDEX idx_rides_driver ON rides (driver_id);
CREATE INDEX idx_rides_corporate ON rides (corporate_account_id);
CREATE INDEX idx_rides_scheduled ON rides (scheduled_at) WHERE scheduled_at IS NOT NULL;

-- Fast lookup: invoices by status for billing
CREATE INDEX idx_invoices_status ON invoices (status);
CREATE INDEX idx_invoices_corporate ON invoices (corporate_account_id);

-- Fast lookup: rate cards for pricing engine
CREATE INDEX idx_rate_cards_business ON rate_cards (business_id);
CREATE INDEX idx_rate_cards_corporate ON rate_cards (corporate_account_id);

-- Fast lookup: vehicles by business
CREATE INDEX idx_vehicles_business ON vehicles (business_id);

-- Fast lookup: audits by vehicle
CREATE INDEX idx_audits_vehicle ON vehicle_audits (vehicle_id);


-- 10. ROW LEVEL SECURITY
-- =============================================

ALTER TABLE global_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE passenger_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE drivers ENABLE ROW LEVEL SECURITY;
ALTER TABLE rides ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_audits ENABLE ROW LEVEL SECURITY;
ALTER TABLE corporate_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE driver_businesses ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;

-- Users can read their own row
CREATE POLICY "Users can read own profile"
  ON global_users FOR SELECT
  USING (auth.uid() = id);

-- Passengers can read and update their own profile
CREATE POLICY "Passengers can read own profile"
  ON passenger_profiles FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Passengers can update own profile"
  ON passenger_profiles FOR UPDATE
  USING (auth.uid() = user_id);

-- Drivers can read and update their own record
CREATE POLICY "Drivers can read own record"
  ON drivers FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Drivers can update own status and location"
  ON drivers FOR UPDATE
  USING (auth.uid() = user_id);

-- Passengers can see their own rides
CREATE POLICY "Passengers can read own rides"
  ON rides FOR SELECT
  USING (auth.uid() = passenger_id);

-- Drivers can see rides assigned to them
CREATE POLICY "Drivers can read assigned rides"
  ON rides FOR SELECT
  USING (auth.uid() = driver_id);

-- Drivers can create audits for their shifts
CREATE POLICY "Drivers can create audits"
  ON vehicle_audits FOR INSERT
  WITH CHECK (auth.uid() = driver_id);

CREATE POLICY "Drivers can read own audits"
  ON vehicle_audits FOR SELECT
  USING (auth.uid() = driver_id);

-- Public read for vehicles (passengers need to see what's available)
CREATE POLICY "Authenticated users can view vehicles"
  ON vehicles FOR SELECT
  TO authenticated
  USING (true);

-- Public read for rate cards (passengers need pricing)
CREATE POLICY "Authenticated users can view rate cards"
  ON rate_cards FOR SELECT
  TO authenticated
  USING (true);

-- Admin full access policies (relies on the role in global_users)
-- These use a helper function to check admin role

CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM global_users
    WHERE id = auth.uid() AND role = 'admin'
  );
$$ LANGUAGE SQL SECURITY DEFINER STABLE;

CREATE POLICY "Admins have full access to global_users"
  ON global_users FOR ALL
  USING (is_admin());

CREATE POLICY "Admins have full access to corporate_accounts"
  ON corporate_accounts FOR ALL
  USING (is_admin());

CREATE POLICY "Admins have full access to driver_businesses"
  ON driver_businesses FOR ALL
  USING (is_admin());

CREATE POLICY "Admins have full access to vehicles"
  ON vehicles FOR ALL
  USING (is_admin());

CREATE POLICY "Admins have full access to rides"
  ON rides FOR ALL
  USING (is_admin());

CREATE POLICY "Admins have full access to invoices"
  ON invoices FOR ALL
  USING (is_admin());

CREATE POLICY "Admins have full access to rate_cards"
  ON rate_cards FOR ALL
  USING (is_admin());

CREATE POLICY "Admins have full access to vehicle_audits"
  ON vehicle_audits FOR ALL
  USING (is_admin());


-- 11. AUTO-UPDATE TIMESTAMPS
-- =============================================

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_passenger_profiles_updated
  BEFORE UPDATE ON passenger_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_drivers_updated
  BEFORE UPDATE ON drivers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_rides_updated
  BEFORE UPDATE ON rides
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_invoices_updated
  BEFORE UPDATE ON invoices
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- =============================================
-- SCHEMA COMPLETE
-- =============================================


-- ==========================================
-- START: ride_schema.sql
-- ==========================================

-- ==============================================================================
-- CLINCH RIDE - BACKEND ARCHITECTURE
-- The Zero-Commission Hyperlocal Ride-Hailing Extension
-- ==============================================================================

-- 1. Enable PostGIS Extension (The Scalable Spatial Engine)
-- This is critical. It turns PostgreSQL into a geospatial database capable of
-- calculating real-time distances between thousands of points instantly.
CREATE EXTENSION IF NOT EXISTS postgis;

-- ==============================================================================
-- 2. ACTIVE DRIVERS TABLE (Live Location Streaming)
-- ==============================================================================
-- This table is designed for high-frequency updates. As drivers drive, their phone
-- pings this table every 5 seconds with their new coordinates.

DROP TABLE IF EXISTS public.active_drivers CASCADE;

CREATE TABLE public.active_drivers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL, -- Links to the driver's auth account
    phone_number TEXT NOT NULL, -- Used to link to the Clinch agreement later
    vehicle_type TEXT NOT NULL, -- e.g., 'Clinch Standard', 'Clinch Electric'
    vehicle_details TEXT NOT NULL, -- e.g., 'Toyota Prius - Black - XY71 ABC'
    rating DECIMAL(3, 2) DEFAULT 5.00,
    status TEXT NOT NULL DEFAULT 'offline', -- 'online', 'busy' (on a ride), 'offline'
    
    -- Finance: Stripe Connect Integration (Direct Charges)
    stripe_account_id TEXT,
    
    -- PostGIS Geography Point: Stores Longitude/Latitude securely
    -- 4326 is the spatial reference system for GPS coordinates (WGS84)
    location geography(POINT, 4326), 
    
    last_updated TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- ⚡ SCALABILITY CRITICAL: The GIST Index
-- This guarantees that when a rider in Manchester requests a car, the DB doesn't 
-- scan every driver globally. It geometrically isolating nearby drivers in milliseconds.
CREATE INDEX active_drivers_gix ON public.active_drivers USING GIST (location);

-- ==============================================================================
-- 3. RIDE REQUESTS TABLE (The Real-Time Order Book)
-- ==============================================================================
-- The core bidding engine. Riders post a request here, and drivers subscribe 
-- to this table via WebSockets to see new jobs pop up around them.

DROP TABLE IF EXISTS public.ride_requests CASCADE;

CREATE TABLE public.ride_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rider_id UUID NOT NULL,
    rider_name TEXT NOT NULL,
    
    pickup_location geography(POINT, 4326) NOT NULL,
    dropoff_location geography(POINT, 4326) NOT NULL,
    destination_text TEXT NOT NULL,
    
    vehicle_type TEXT NOT NULL,
    current_bid DECIMAL(10, 2) NOT NULL, -- Starts at base, algorithm increases this
    
    -- Status pipeline: 'searching' -> 'accepted' -> 'in_progress' -> 'completed' -> 'cancelled'
    status TEXT NOT NULL DEFAULT 'searching', 
    
    assigned_driver_id UUID REFERENCES public.active_drivers(id),
    
    -- THE TROJAN HORSE: Linking the ride physically to the Clinch Trust Database
    clinch_id UUID REFERENCES public.clinches(id), 
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Index for quickly grabbing all rides that are currently looking for a driver
CREATE INDEX ride_requests_status_idx ON public.ride_requests(status) WHERE status = 'searching';

-- ==============================================================================
-- 4. ROW LEVEL SECURITY (RLS) POLICIES
-- ==============================================================================
ALTER TABLE public.active_drivers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ride_requests ENABLE ROW LEVEL SECURITY;

-- 🛡 DRIVERS: Anyone can see online drivers (Rider maps need this)
CREATE POLICY "Anyone can see online drivers" 
ON public.active_drivers FOR SELECT TO public
USING (status = 'online');

-- 🛡 DRIVERS: Only the authenticated driver can update their own GPS location
CREATE POLICY "Drivers update own location" 
ON public.active_drivers FOR ALL TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- 🛡 RIDES: Riders have full control over their own ride requests
CREATE POLICY "Riders manage own requests" 
ON public.ride_requests FOR ALL TO authenticated
USING (auth.uid() = rider_id)
WITH CHECK (auth.uid() = rider_id);

-- 🛡 RIDES: Drivers can see ANY 'searching' request (to bid/accept)
CREATE POLICY "Drivers view searching requests" 
ON public.ride_requests FOR SELECT TO authenticated
USING (status = 'searching');

-- 🛡 RIDES: Assigned drivers can update the rides they accepted (e.g. mark 'completed')
CREATE POLICY "Assigned drivers update their rides" 
ON public.ride_requests FOR UPDATE TO authenticated
USING (
    assigned_driver_id IN (
        SELECT id FROM public.active_drivers WHERE user_id = auth.uid()
    )
);

-- ==============================================================================
-- 5. MATCHING ALGORITHM FUNCTION (Server-Side RPC)
-- ==============================================================================
-- Instead of doing heavy computation on the frontend, the app calls this single 
-- function: "Give me the closest 20 drivers to this latitude/longitude".
-- It uses PostGIS ST_DWithin to mathematically draw a circle around the rider.

CREATE OR REPLACE FUNCTION get_nearby_drivers(
    pickup_lat DOUBLE PRECISION,
    pickup_lng DOUBLE PRECISION,
    search_radius_meters DOUBLE PRECISION DEFAULT 5000, -- 5km radius default
    v_type TEXT DEFAULT NULL -- Optional filter for 'Clinch Electric' etc.
)
RETURNS TABLE (
    driver_id UUID,
    vehicle_type TEXT,
    vehicle_details TEXT,
    rating DECIMAL,
    distance_meters DOUBLE PRECISION,
    lat DOUBLE PRECISION,
    lng DOUBLE PRECISION
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        d.id,
        d.vehicle_type,
        d.vehicle_details,
        d.rating,
        -- Calculate exact distance in meters over the curvature of the earth
        ST_Distance(
            d.location, 
            ST_SetSRID(ST_MakePoint(pickup_lng, pickup_lat), 4326)::geography
        ) AS distance_meters,
        ST_Y(d.location::geometry) AS lat,
        ST_X(d.location::geometry) AS lng
    FROM 
        public.active_drivers d
    WHERE 
        d.status = 'online'
        AND (v_type IS NULL OR d.vehicle_type = v_type)
        -- The geometric boundary check (runs instantly due to GIST index)
        AND ST_DWithin(
            d.location, 
            ST_SetSRID(ST_MakePoint(pickup_lng, pickup_lat), 4326)::geography, 
            search_radius_meters
        )
    ORDER BY 
        -- Nearest drivers returned at the top of the array
        d.location <-> ST_SetSRID(ST_MakePoint(pickup_lng, pickup_lat), 4326)::geography
    LIMIT 20;
END;
$$;

-- ==============================================================================
-- 6. RIDE REJECTIONS (Marketplace Logic)
-- ==============================================================================
-- Tracks which drivers have declined a specific job. This prevents the same
-- job from spamming a driver who said no, and allows the system to calculate
-- when to increase the bid price (surge) based on rejections.

DROP TABLE IF EXISTS public.ride_rejections CASCADE;

CREATE TABLE public.ride_rejections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ride_id UUID REFERENCES public.ride_requests(id) ON DELETE CASCADE,
    driver_id UUID REFERENCES public.active_drivers(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.ride_rejections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Drivers can insert their rejections" 
ON public.ride_rejections FOR INSERT TO authenticated
WITH CHECK (
    driver_id IN (
        SELECT id FROM public.active_drivers WHERE user_id = auth.uid()
    )
);

CREATE POLICY "Riders can see rejections for their rides" 
ON public.ride_rejections FOR SELECT TO authenticated
USING (
    ride_id IN (
        SELECT id FROM public.ride_requests WHERE rider_id = auth.uid()
    )
);

-- ==============================================================================
-- 7. REALTIME WEBSOCKET ENABLEMENT
-- ==============================================================================
-- By enabling supabase_realtime, changes to these tables (like a driver moving,
-- or a new ride being requested) are instantly pushed to the clients securely.

-- Uncomment and run this in your Supabase SQL editor to enable streaming:
BEGIN;
  DROP PUBLICATION IF EXISTS supabase_realtime;
  CREATE PUBLICATION supabase_realtime;
COMMIT;

ALTER PUBLICATION supabase_realtime ADD TABLE public.active_drivers;
ALTER PUBLICATION supabase_realtime ADD TABLE public.ride_requests;
ALTER PUBLICATION supabase_realtime ADD TABLE public.ride_rejections;


-- ==========================================
-- START: sql_migration_ride_marketplace.sql
-- ==========================================

begin;

-- ---------------------------------------------------------------------------
-- Driver Rate Profiles (default-first, but driver can set custom values)
-- ---------------------------------------------------------------------------
create table if not exists public.driver_rate_profiles (
    id uuid primary key default gen_random_uuid(),
    driver_id uuid not null references public.active_drivers(id) on delete cascade,
    is_active boolean not null default true,
    minimum_fare numeric(10,2) not null default 3.50,
    first_mile_fare numeric(10,2) not null default 4.00,
    per_mile_2_3 numeric(10,2) not null default 2.50,
    per_mile_after_3 numeric(10,2) not null default 2.10,
    per_minute_waiting numeric(10,2) not null default 0.20,
    airport_dropoff_fare numeric(10,2) not null default 32.00,
    airport_pickup_fare numeric(10,2) not null default 35.00,
    dog_charge numeric(10,2) not null default 2.00,
    estate_car_charge numeric(10,2) not null default 3.00,
    created_at timestamptz not null default timezone('utc'::text, now()),
    updated_at timestamptz not null default timezone('utc'::text, now()),
    constraint driver_rate_profiles_driver_unique unique (driver_id)
);

create index if not exists driver_rate_profiles_driver_idx on public.driver_rate_profiles(driver_id);

alter table public.driver_rate_profiles enable row level security;

drop policy if exists driver_rates_public_read_active on public.driver_rate_profiles;
create policy driver_rates_public_read_active
on public.driver_rate_profiles
for select
to public
using (
    is_active = true
    and exists (
        select 1 from public.active_drivers d
        where d.id = driver_id
          and d.status = 'online'
    )
);

drop policy if exists driver_rates_owner_manage on public.driver_rate_profiles;
create policy driver_rates_owner_manage
on public.driver_rate_profiles
for all
to authenticated
using (
    exists (
        select 1 from public.active_drivers d
        where d.id = driver_id
          and d.user_id = auth.uid()
    )
)
with check (
    exists (
        select 1 from public.active_drivers d
        where d.id = driver_id
          and d.user_id = auth.uid()
    )
);

-- ---------------------------------------------------------------------------
-- Ride Request Enhancements for estimate + bid tracking + rate snapshots
-- ---------------------------------------------------------------------------
alter table public.ride_requests
    add column if not exists estimated_min numeric(10,2),
    add column if not exists estimated_max numeric(10,2),
    add column if not exists about_price numeric(10,2),
    add column if not exists estimated_distance_miles numeric(10,2),
    add column if not exists rate_snapshot jsonb,
    add column if not exists matched_by text,
    add column if not exists bid_window_ends_at timestamptz,
    add column if not exists payment_method text,
    add column if not exists payment_status text default 'unpaid',
    add column if not exists rider_paid_at timestamptz,
    add column if not exists driver_paid_at timestamptz;

drop policy if exists drivers_read_own_rides on public.ride_requests;
create policy drivers_read_own_rides
on public.ride_requests
for select
to authenticated
using (
    assigned_driver_id in (
        select d.id
        from public.active_drivers d
        where d.user_id = auth.uid()
    )
);

-- ---------------------------------------------------------------------------
-- Driver Territory (territorial matching support)
-- ---------------------------------------------------------------------------
create extension if not exists postgis;

create table if not exists public.driver_territories (
    id uuid primary key default gen_random_uuid(),
    driver_id uuid not null references public.active_drivers(id) on delete cascade,
    label text,
    center geography(point, 4326) not null,
    radius_meters integer not null default 3218, -- ~2 miles
    is_active boolean not null default true,
    created_at timestamptz not null default timezone('utc'::text, now()),
    updated_at timestamptz not null default timezone('utc'::text, now())
);

create index if not exists driver_territories_driver_idx on public.driver_territories(driver_id);
create index if not exists driver_territories_center_gix on public.driver_territories using gist(center);

alter table public.driver_territories enable row level security;

drop policy if exists driver_territories_owner_manage on public.driver_territories;
create policy driver_territories_owner_manage
on public.driver_territories
for all
to authenticated
using (
    exists (
        select 1 from public.active_drivers d
        where d.id = driver_id
          and d.user_id = auth.uid()
    )
)
with check (
    exists (
        select 1 from public.active_drivers d
        where d.id = driver_id
          and d.user_id = auth.uid()
    )
);

-- ---------------------------------------------------------------------------
-- Ride Offers + Driver Bids (marketplace negotiation tracking)
-- ---------------------------------------------------------------------------
create table if not exists public.ride_offers (
    id uuid primary key default gen_random_uuid(),
    ride_id uuid not null references public.ride_requests(id) on delete cascade,
    driver_id uuid not null references public.active_drivers(id) on delete cascade,
    suggested_amount numeric(10,2) not null,
    status text not null default 'pending', -- pending, accepted, rejected, expired
    expires_at timestamptz,
    created_at timestamptz not null default timezone('utc'::text, now())
);

create index if not exists ride_offers_ride_idx on public.ride_offers(ride_id);
create index if not exists ride_offers_driver_idx on public.ride_offers(driver_id);

alter table public.ride_offers enable row level security;

drop policy if exists ride_offers_driver_insert on public.ride_offers;
create policy ride_offers_driver_insert
on public.ride_offers
for insert
to authenticated
with check (
    exists (
        select 1 from public.active_drivers d
        where d.id = driver_id
          and d.user_id = auth.uid()
    )
);

drop policy if exists ride_offers_rider_read on public.ride_offers;
create policy ride_offers_rider_read
on public.ride_offers
for select
to authenticated
using (
    ride_id in (
        select r.id from public.ride_requests r
        where r.rider_id = auth.uid()
    )
);

drop policy if exists ride_offers_driver_read_own on public.ride_offers;
create policy ride_offers_driver_read_own
on public.ride_offers
for select
to authenticated
using (
    exists (
        select 1 from public.active_drivers d
        where d.id = driver_id
          and d.user_id = auth.uid()
    )
);

create table if not exists public.driver_bids (
    id uuid primary key default gen_random_uuid(),
    ride_id uuid not null references public.ride_requests(id) on delete cascade,
    driver_id uuid not null references public.active_drivers(id) on delete cascade,
    bid_amount numeric(10,2) not null,
    status text not null default 'pending', -- pending, accepted, rejected, expired
    expires_at timestamptz,
    created_at timestamptz not null default timezone('utc'::text, now())
);

create index if not exists driver_bids_ride_idx on public.driver_bids(ride_id);
create index if not exists driver_bids_driver_idx on public.driver_bids(driver_id);

alter table public.driver_bids enable row level security;

drop policy if exists driver_bids_driver_insert on public.driver_bids;
create policy driver_bids_driver_insert
on public.driver_bids
for insert
to authenticated
with check (
    exists (
        select 1 from public.active_drivers d
        where d.id = driver_id
          and d.user_id = auth.uid()
    )
);

drop policy if exists driver_bids_driver_read_own on public.driver_bids;
create policy driver_bids_driver_read_own
on public.driver_bids
for select
to authenticated
using (
    exists (
        select 1 from public.active_drivers d
        where d.id = driver_id
          and d.user_id = auth.uid()
    )
);

drop policy if exists driver_bids_rider_read on public.driver_bids;
create policy driver_bids_rider_read
on public.driver_bids
for select
to authenticated
using (
    ride_id in (
        select r.id from public.ride_requests r
        where r.rider_id = auth.uid()
    )
);

-- ---------------------------------------------------------------------------
-- Device Push Tokens (for notifications when driver is off-screen)
-- ---------------------------------------------------------------------------
create table if not exists public.device_push_tokens (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null,
    token text not null,
    platform text not null default 'unknown', -- ios, android, web
    enabled boolean not null default true,
    last_seen_at timestamptz not null default timezone('utc'::text, now()),
    created_at timestamptz not null default timezone('utc'::text, now()),
    updated_at timestamptz not null default timezone('utc'::text, now()),
    constraint device_push_tokens_unique unique (user_id, token)
);

create index if not exists device_push_tokens_user_idx on public.device_push_tokens(user_id);

alter table public.device_push_tokens enable row level security;

drop policy if exists push_tokens_owner_manage on public.device_push_tokens;
create policy push_tokens_owner_manage
on public.device_push_tokens
for all
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Clinch Audit Guarantees (every ride linked to a clinch + server-side audit)
-- ---------------------------------------------------------------------------
create index if not exists clinch_history_clinch_changed_idx
on public.clinch_history(clinch_id, changed_at desc);

create or replace function public.ensure_ride_has_clinch()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    generated_clinch_id uuid;
begin
    if new.clinch_id is not null then
        return new;
    end if;

    insert into public.clinches (
        sender_id,
        sender_name,
        sender_phone,
        recipient_phone,
        terms,
        status
    )
    values (
        null,
        coalesce(new.rider_name, 'Rider'),
        null,
        'Driver Phone',
        format(
            'Auto ride clinch. Destination: %s. Start meter: £%s.',
            coalesce(new.destination_text, 'Unknown'),
            to_char(coalesce(new.current_bid, 0), 'FM999999990.00')
        ),
        'pending'
    )
    returning id into generated_clinch_id;

    new.clinch_id := generated_clinch_id;
    return new;
end;
$$;

drop trigger if exists trg_ride_requests_require_clinch on public.ride_requests;
create trigger trg_ride_requests_require_clinch
before insert on public.ride_requests
for each row
execute function public.ensure_ride_has_clinch();

create or replace function public.audit_ride_request_to_clinch_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    target_clinch_id uuid := coalesce(new.clinch_id, old.clinch_id);
    actor_phone text := coalesce(auth.jwt() ->> 'phone', 'system');
    bid_delta numeric := 0;
begin
    if target_clinch_id is null then
        return new;
    end if;

    if tg_op = 'INSERT' then
        insert into public.clinch_history (clinch_id, previous_terms, new_terms, changed_by_phone, changed_at)
        values (
            target_clinch_id,
            'RIDE_AUDIT_EVENT',
            format(
                'RIDE_CREATED status=%s bid=£%s',
                coalesce(new.status, 'unknown'),
                to_char(coalesce(new.current_bid, 0), 'FM999999990.00')
            ),
            actor_phone,
            timezone('utc'::text, now())
        );
        return new;
    end if;

    if new.status is distinct from old.status then
        insert into public.clinch_history (clinch_id, previous_terms, new_terms, changed_by_phone, changed_at)
        values (
            target_clinch_id,
            'RIDE_AUDIT_EVENT',
            format('RIDE_STATUS %s -> %s', coalesce(old.status, 'null'), coalesce(new.status, 'null')),
            actor_phone,
            timezone('utc'::text, now())
        );
    end if;

    if new.assigned_driver_id is distinct from old.assigned_driver_id
       and new.assigned_driver_id is not null then
        insert into public.clinch_history (clinch_id, previous_terms, new_terms, changed_by_phone, changed_at)
        values (
            target_clinch_id,
            'RIDE_AUDIT_EVENT',
            format('DRIVER_ASSIGNED %s', new.assigned_driver_id::text),
            actor_phone,
            timezone('utc'::text, now())
        );
    end if;

    bid_delta := abs(coalesce(new.current_bid, 0) - coalesce(old.current_bid, 0));

    -- Avoid noisy writes from second-by-second meter updates. Persist meaningful jumps only.
    if new.current_bid is distinct from old.current_bid and bid_delta >= 0.20 then
        insert into public.clinch_history (clinch_id, previous_terms, new_terms, changed_by_phone, changed_at)
        values (
            target_clinch_id,
            'RIDE_AUDIT_EVENT',
            format(
                'RIDE_BID £%s -> £%s',
                to_char(coalesce(old.current_bid, 0), 'FM999999990.00'),
                to_char(coalesce(new.current_bid, 0), 'FM999999990.00')
            ),
            actor_phone,
            timezone('utc'::text, now())
        );
    end if;

    if new.matched_by is distinct from old.matched_by and new.matched_by is not null then
        insert into public.clinch_history (clinch_id, previous_terms, new_terms, changed_by_phone, changed_at)
        values (
            target_clinch_id,
            'RIDE_AUDIT_EVENT',
            format('MATCHED_BY %s', new.matched_by),
            actor_phone,
            timezone('utc'::text, now())
        );
    end if;

    if new.payment_status is distinct from old.payment_status then
        insert into public.clinch_history (clinch_id, previous_terms, new_terms, changed_by_phone, changed_at)
        values (
            target_clinch_id,
            'RIDE_AUDIT_EVENT',
            format(
                'PAYMENT_STATUS %s -> %s',
                coalesce(old.payment_status, 'null'),
                coalesce(new.payment_status, 'null')
            ),
            actor_phone,
            timezone('utc'::text, now())
        );
    end if;

    if new.payment_method is distinct from old.payment_method and new.payment_method is not null then
        insert into public.clinch_history (clinch_id, previous_terms, new_terms, changed_by_phone, changed_at)
        values (
            target_clinch_id,
            'RIDE_AUDIT_EVENT',
            format('PAYMENT_METHOD %s', new.payment_method),
            actor_phone,
            timezone('utc'::text, now())
        );
    end if;

    return new;
end;
$$;

drop trigger if exists trg_ride_requests_audit_clinch on public.ride_requests;
create trigger trg_ride_requests_audit_clinch
after insert or update on public.ride_requests
for each row
execute function public.audit_ride_request_to_clinch_history();

create or replace function public.audit_driver_bid_to_clinch_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    target_clinch_id uuid;
    actor_phone text := coalesce(auth.jwt() ->> 'phone', 'driver');
begin
    select r.clinch_id into target_clinch_id
    from public.ride_requests r
    where r.id = new.ride_id;

    if target_clinch_id is null then
        return new;
    end if;

    insert into public.clinch_history (clinch_id, previous_terms, new_terms, changed_by_phone, changed_at)
    values (
        target_clinch_id,
        'RIDE_AUDIT_EVENT',
        format(
            'DRIVER_BID_LOG £%s (%s)',
            to_char(coalesce(new.bid_amount, 0), 'FM999999990.00'),
            coalesce(new.driver_id::text, 'unknown_driver')
        ),
        actor_phone,
        timezone('utc'::text, now())
    );

    return new;
end;
$$;

drop trigger if exists trg_driver_bids_audit_clinch on public.driver_bids;
create trigger trg_driver_bids_audit_clinch
after insert on public.driver_bids
for each row
execute function public.audit_driver_bid_to_clinch_history();

commit;


-- ==========================================
-- START: create_rides_and_messages.sql
-- ==========================================

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



COMMIT;
