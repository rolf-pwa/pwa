-- The fact find (know-your-client) for one person on an insurance file: each fact with where it came from, edited and confirmed by Rolf, then confirmed by
-- the client in the portal like any other insurance document (kind 'fact_find' on insurance_documents).
ALTER TABLE public.insurance_documents DROP CONSTRAINT IF EXISTS insurance_documents_kind_check;
ALTER TABLE public.insurance_documents ADD CONSTRAINT insurance_documents_kind_check CHECK (kind IN ('disclosure_privacy', 'reason_why', 'fact_find'));

CREATE TABLE IF NOT EXISTS public.insurance_fact_finds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  file_id uuid REFERENCES public.insurance_files(id) ON DELETE SET NULL,
  facts jsonb NOT NULL DEFAULT '[]'::jsonb,
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  dropped int NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'confirmed')),
  document_id uuid REFERENCES public.insurance_documents(id) ON DELETE SET NULL,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_insurance_fact_finds_contact ON public.insurance_fact_finds (contact_id, created_at DESC);
-- Service role only: read and written through review-agent-admin, which checks the caller is staff.
ALTER TABLE public.insurance_fact_finds ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.insurance_fact_finds TO service_role;
