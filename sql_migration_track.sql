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
    SELECT status, terms INTO v_status, v_old_terms
    FROM public.clinches
    WHERE id = p_clinch_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Clinch not found';
    END IF;

    IF v_status = 'clinched' THEN
        RAISE EXCEPTION 'Cannot modify terms because this agreement has already been clinched.';
    END IF;

    IF v_old_terms = p_new_terms THEN
        RETURN true;
    END IF;

    UPDATE public.clinches
    SET terms = p_new_terms,
        status = 'pending',
        rejected_at = NULL 
    WHERE id = p_clinch_id;

    INSERT INTO public.clinch_history (clinch_id, previous_terms, new_terms, changed_by_phone, changed_at)
    VALUES (p_clinch_id, v_old_terms, p_new_terms, p_changed_by_phone, timezone('utc'::text, now()));

    RETURN true;
END;
$$;
