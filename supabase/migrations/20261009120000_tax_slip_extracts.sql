-- What was read from a household's tax slips (T3 / T5) in the Vault's Tax folder, kept so the Governance Audit does not
-- re-read the same PDF on every run. Keyed by the Drive file and its last-modified time. Written only by the service role.
CREATE TABLE IF NOT EXISTS public.tax_slip_extracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  drive_id text NOT NULL,
  file_name text,
  modified_time text,
  extraction jsonb NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_tax_slip_extracts_file ON public.tax_slip_extracts (household_id, drive_id);
ALTER TABLE public.tax_slip_extracts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service manages tax slip extracts" ON public.tax_slip_extracts FOR ALL TO service_role USING (true) WITH CHECK (true);
-- Default privileges also hand out write/TRUNCATE to the app roles, which RLS does not stop.
REVOKE ALL ON public.tax_slip_extracts FROM anon, authenticated;
GRANT ALL ON public.tax_slip_extracts TO service_role;
