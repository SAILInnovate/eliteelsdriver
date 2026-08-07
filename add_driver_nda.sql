-- =====================================================================
-- DRIVER NDA ACCEPTANCES
-- Run in Supabase SQL Editor.
--
-- Records each driver's electronic acceptance of the Elite ELS
-- Non-Disclosure & Confidentiality Agreement, signed during signup
-- (Apple-style scroll → type full name → Agree & Sign).
-- One row per driver per NDA version, so bumping NDA_VERSION in the app
-- forces re-acceptance while preserving the old signature record.
-- Rows are write-once evidence: drivers can insert and read their own,
-- but never update or delete (no policies granted for those).
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.driver_nda_acceptances (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  nda_version  TEXT NOT NULL,
  full_name    TEXT NOT NULL,          -- profile name at time of signing
  signed_name  TEXT NOT NULL,          -- name the driver typed as signature
  phone        TEXT,                   -- auth phone at time of signing
  user_agent   TEXT,                   -- device evidence
  signed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, nda_version)
);

ALTER TABLE public.driver_nda_acceptances ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Drivers can read own NDA acceptances" ON public.driver_nda_acceptances;
CREATE POLICY "Drivers can read own NDA acceptances" ON public.driver_nda_acceptances
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Drivers can sign NDA" ON public.driver_nda_acceptances;
CREATE POLICY "Drivers can sign NDA" ON public.driver_nda_acceptances
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- No UPDATE or DELETE policies: acceptances are immutable audit records.
-- Admin dashboard (service role) bypasses RLS and can read everything.
