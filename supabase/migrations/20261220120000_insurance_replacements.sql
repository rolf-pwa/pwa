-- Replacing a life insurance policy (BC): the Declaration and the written explanation go to the client before the application is started.
-- The agent (Rolf) signs the Declaration when both are sent, so his signature is recorded on the document itself.
ALTER TABLE public.insurance_documents DROP CONSTRAINT IF EXISTS insurance_documents_kind_check;
ALTER TABLE public.insurance_documents ADD CONSTRAINT insurance_documents_kind_check CHECK (kind IN ('disclosure_privacy', 'reason_why', 'fact_find', 'replacement_declaration', 'replacement_explanation'));
ALTER TABLE public.insurance_documents
  ADD COLUMN IF NOT EXISTS agent_name text,
  ADD COLUMN IF NOT EXISTS agent_typed_name text,
  ADD COLUMN IF NOT EXISTS agent_signed_at timestamptz,
  ADD COLUMN IF NOT EXISTS agent_ip text,
  ADD COLUMN IF NOT EXISTS agent_statement text;

CREATE TABLE IF NOT EXISTS public.insurance_replacements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  file_id uuid REFERENCES public.insurance_files(id) ON DELETE SET NULL,
  client_ids uuid[] NOT NULL DEFAULT '{}',
  replaced_policy_id uuid REFERENCES public.insurance_policies(id) ON DELETE SET NULL,
  new_policy jsonb NOT NULL DEFAULT '{}'::jsonb,
  facts jsonb NOT NULL DEFAULT '[]'::jsonb,
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  dropped int NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'confirmed')),
  explanation_doc_id uuid REFERENCES public.insurance_documents(id) ON DELETE SET NULL,
  declaration_doc_id uuid REFERENCES public.insurance_documents(id) ON DELETE SET NULL,
  created_by text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_insurance_replacements_household ON public.insurance_replacements (household_id, created_at DESC);
-- Service role only: read and written through review-agent-admin, which checks the caller is staff.
ALTER TABLE public.insurance_replacements ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.insurance_replacements TO service_role;
