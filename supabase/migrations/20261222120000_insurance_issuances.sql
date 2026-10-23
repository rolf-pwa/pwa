-- The application and delivery of an insurance policy: the iA application documents and the issued contract (the proof of electronic delivery) saved in Drive and
-- attached to the insurance file, the policy recorded as in force, and a closing letter the client confirms in the portal (kind 'delivery_letter').
ALTER TABLE public.insurance_documents DROP CONSTRAINT IF EXISTS insurance_documents_kind_check;
ALTER TABLE public.insurance_documents ADD CONSTRAINT insurance_documents_kind_check CHECK (kind IN ('disclosure_privacy', 'reason_why', 'fact_find', 'replacement_declaration', 'replacement_explanation', 'delivery_letter'));

CREATE TABLE IF NOT EXISTS public.insurance_issuances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  file_id uuid REFERENCES public.insurance_files(id) ON DELETE SET NULL,
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  policy_id uuid REFERENCES public.insurance_policies(id) ON DELETE SET NULL,
  carrier text NOT NULL,
  product text NOT NULL,
  policy_type text NOT NULL,
  policy_number text NOT NULL,
  coverage_amount numeric,
  premium_amount numeric,
  premium_frequency text,
  issued_on date,
  delivered_on date,
  primary_beneficiary text,
  contract_url text,
  contract_drive_id text,
  application_urls jsonb NOT NULL DEFAULT '[]'::jsonb,
  letter_document_id uuid REFERENCES public.insurance_documents(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'recorded' CHECK (status IN ('recorded', 'sent', 'confirmed')),
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_insurance_issuances_household ON public.insurance_issuances (household_id, created_at DESC);
-- Service role only: read and written through review-agent-admin, which checks the caller is staff.
ALTER TABLE public.insurance_issuances ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.insurance_issuances TO service_role;
