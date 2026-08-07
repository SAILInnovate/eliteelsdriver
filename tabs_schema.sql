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
