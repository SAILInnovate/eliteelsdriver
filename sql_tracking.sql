CREATE TABLE IF NOT EXISTS public.clinch_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clinch_id UUID REFERENCES public.clinches(id) ON DELETE CASCADE,
    previous_terms TEXT NOT NULL,
    new_terms TEXT NOT NULL,
    changed_by UUID REFERENCES auth.users(id),
    changed_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);
ALTER TABLE public.clinch_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read history" ON public.clinch_history FOR SELECT TO public USING (true);
CREATE POLICY "Anyone can insert history" ON public.clinch_history FOR INSERT TO public WITH CHECK (true);
