-- Driver documents table for licence, PCO, DBS, etc.
CREATE TABLE IF NOT EXISTS public.driver_documents (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    driver_id UUID REFERENCES auth.users(id) NOT NULL,
    doc_type TEXT NOT NULL, -- driving_licence, pco_licence, dvla_check_code, proof_of_id, profile_photo
    file_url TEXT,
    uploaded_at TIMESTAMPTZ DEFAULT now(),
    verified BOOLEAN DEFAULT false,
    UNIQUE(driver_id, doc_type)
);

ALTER TABLE public.driver_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Drivers can view own docs" ON public.driver_documents FOR SELECT USING (auth.uid() = driver_id);
CREATE POLICY "Drivers can insert own docs" ON public.driver_documents FOR INSERT WITH CHECK (auth.uid() = driver_id);
CREATE POLICY "Drivers can update own docs" ON public.driver_documents FOR UPDATE USING (auth.uid() = driver_id);
