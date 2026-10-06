-- Estate documents (Will, Power of Attorney, trust...) read from the Vault's Estate folder by the V2 scan and kept
-- after advisor approval in Glass-Box Review. The Sovereignty Review reads these for its Estate / Legacy status
-- instead of relying on hand-typed fields. Strictly additive; written only by the service role.
CREATE TABLE IF NOT EXISTS public.estate_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,   -- whose document it is, when matched to a member
  document_type text NOT NULL CHECK (document_type IN ('will','power_of_attorney','trust','representation_agreement','other')),
  subject_name text,                -- testator / donor / settlor as printed on the document
  document_date date,               -- date signed / executed
  signed boolean,                   -- null = couldn't tell from the document
  executor text,                    -- executor(s), attorney(s) or trustee(s)
  beneficiaries text,
  notes text,
  drive_id text NOT NULL,
  file_name text,
  source_audit_id uuid REFERENCES public.stage2_verification_audit(id) ON DELETE SET NULL,
  approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_estate_documents_file_type ON public.estate_documents (drive_id, document_type);
CREATE INDEX IF NOT EXISTS idx_estate_documents_household ON public.estate_documents (household_id, document_type);

ALTER TABLE public.estate_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff view estate documents" ON public.estate_documents FOR SELECT TO authenticated USING (true);
CREATE POLICY "Service manages estate documents" ON public.estate_documents FOR ALL TO service_role USING (true) WITH CHECK (true);
-- Staff read only (default privileges also hand out write/TRUNCATE, which RLS does not stop).
REVOKE ALL ON public.estate_documents FROM anon, authenticated;
GRANT SELECT ON public.estate_documents TO authenticated;
GRANT ALL ON public.estate_documents TO service_role;
