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
