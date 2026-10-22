-- Saved life insurance needs analyses (DIME: Debt, Income, Mortgage, Estate). One row per person per save, so the file shows what the need was and when.
CREATE TABLE IF NOT EXISTS public.insurance_needs_analyses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid REFERENCES public.households(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  method text NOT NULL DEFAULT 'dime' CHECK (method IN ('dime')),
  inputs jsonb NOT NULL,
  results jsonb NOT NULL,
  note text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_insurance_needs_contact ON public.insurance_needs_analyses (contact_id, created_at DESC);

ALTER TABLE public.insurance_needs_analyses ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, DELETE ON public.insurance_needs_analyses TO authenticated;
GRANT ALL ON public.insurance_needs_analyses TO service_role;
CREATE POLICY "Advisors can view needs analyses" ON public.insurance_needs_analyses FOR SELECT TO authenticated USING (true);
CREATE POLICY "Advisors can save needs analyses" ON public.insurance_needs_analyses FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Advisors can delete needs analyses" ON public.insurance_needs_analyses FOR DELETE TO authenticated USING (true);
