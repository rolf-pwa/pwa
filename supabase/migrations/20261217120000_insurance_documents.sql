-- Insurance documents the client signs in the portal (the advisor disclosure and privacy consent first), with an audit trail per signature.
--   insurance_doc_templates   which Google Doc is the master for each kind of document; read fresh from Drive every time one is prepared
--   insurance_documents       one row per document sent: the exact wording sent (frozen), its fingerprint and the Drive version it came from
--   insurance_document_signers  one row per person who must sign, with what they agreed to, when, and from where
-- The functions write all of these with the service role; staff read them through the functions.
CREATE TABLE IF NOT EXISTS public.insurance_doc_templates (
  kind text PRIMARY KEY CHECK (kind IN ('disclosure_privacy', 'reason_why')),
  title text NOT NULL,
  drive_file_id text NOT NULL,
  advisor_contact text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.insurance_doc_templates TO authenticated;
GRANT ALL ON public.insurance_doc_templates TO service_role;
ALTER TABLE public.insurance_doc_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Advisors can view document templates" ON public.insurance_doc_templates FOR SELECT TO authenticated USING (true);

INSERT INTO public.insurance_doc_templates (kind, title, drive_file_id, advisor_contact) VALUES
  ('disclosure_privacy', 'Advisor Disclosure and Privacy Consent', '1x8d4lUOkGQclGdHTblof-K8NgFvuPf047g3IncZ6-wo', E'Rolf Issler, ProsperWise Advisors\nrolf@prosperwise.ca'),
  ('reason_why', 'Reason Why: Life', '1Y_C81Ic5k89nRbac5bfk-CbqDj2HHx6wa9zj4jb0gCY', '')
ON CONFLICT (kind) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.insurance_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  file_id uuid REFERENCES public.insurance_files(id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('disclosure_privacy', 'reason_why')),
  title text NOT NULL,
  template_drive_id text NOT NULL,
  template_modified text,
  template_version text,
  body_md text NOT NULL,
  body_hash text NOT NULL,
  status text NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'partly_signed', 'signed', 'void')),
  task_id uuid REFERENCES public.pm_tasks(id) ON DELETE SET NULL,
  sent_by text,
  sent_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  pdf_drive_id text,
  pdf_url text,
  void_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_insurance_documents_household ON public.insurance_documents (household_id, sent_at DESC);
GRANT ALL ON public.insurance_documents TO service_role;
ALTER TABLE public.insurance_documents ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.insurance_document_signers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES public.insurance_documents(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'signed')),
  typed_name text,
  casl_choice text CHECK (casl_choice IS NULL OR casl_choice IN ('yes', 'no')),
  casl_initials text,
  casl_email text,
  statement_text text,
  signed_at timestamptz,
  ip text,
  user_agent text,
  UNIQUE (document_id, contact_id)
);
CREATE INDEX IF NOT EXISTS idx_insurance_document_signers_contact ON public.insurance_document_signers (contact_id, status);
GRANT ALL ON public.insurance_document_signers TO service_role;
ALTER TABLE public.insurance_document_signers ENABLE ROW LEVEL SECURITY;
