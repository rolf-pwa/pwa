-- Shoebox auto-classify/rename/file agent: each pending proposal is a
-- suggested rename + destination folder for one Shoebox file, never
-- applied until staff approve it (possibly after editing it) via
-- vault-service's approveShoeboxProposal action.
CREATE TABLE public.vault_shoebox_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  drive_id text NOT NULL,
  household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL, -- uploader, nullable
  original_name text NOT NULL,
  document_type text NOT NULL,             -- curated enum value or 'Other'
  other_label text,                        -- only when document_type = 'Other'
  document_date date,
  document_subject_first_name text,
  document_subject_last_name text,
  proposed_name text NOT NULL,
  proposed_category_slug text,             -- null = "leave in Shoebox"
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  reviewed_by uuid REFERENCES auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Prevents a duplicate pending proposal for the same file if the live
-- upload-trigger and a manual "Scan Shoebox" race on it -- the insert just
-- fails with 23505 and is caught/ignored rather than needing to be
-- prevented upstream.
CREATE UNIQUE INDEX idx_vault_shoebox_proposals_pending_drive
  ON public.vault_shoebox_proposals (drive_id) WHERE status = 'pending';
CREATE INDEX idx_vault_shoebox_proposals_household
  ON public.vault_shoebox_proposals (household_id, status);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.vault_shoebox_proposals TO authenticated;
GRANT ALL ON public.vault_shoebox_proposals TO service_role;

ALTER TABLE public.vault_shoebox_proposals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff manage shoebox proposals" ON public.vault_shoebox_proposals
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Service manage shoebox proposals" ON public.vault_shoebox_proposals
  FOR ALL TO service_role USING (true) WITH CHECK (true);
