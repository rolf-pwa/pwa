-- Insurance Planning Reports filed for a household: the PDF in Advisor Files / Reports and what it covered, so the file shows what the client was given and when.
CREATE TABLE IF NOT EXISTS public.insurance_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  title text NOT NULL,
  contact_ids uuid[] NOT NULL DEFAULT '{}',
  kinds text[] NOT NULL DEFAULT '{}',
  include_options boolean NOT NULL DEFAULT true,
  cover_note text,
  pdf_drive_id text NOT NULL,
  pdf_url text NOT NULL,
  pdf_name text NOT NULL,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_insurance_reports_household ON public.insurance_reports (household_id, created_at DESC);

ALTER TABLE public.insurance_reports ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.insurance_reports TO authenticated;
GRANT ALL ON public.insurance_reports TO service_role;
CREATE POLICY "Advisors can view insurance reports" ON public.insurance_reports FOR SELECT TO authenticated USING (true);
