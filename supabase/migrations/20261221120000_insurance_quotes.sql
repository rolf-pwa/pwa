-- Carrier quotes compared for an insurance recommendation: one row per quote, per insured person. A quote can be marked recommended (with the reason),
-- considered, or rejected. The comparison is filed as the "alternatives considered" evidence, and the recommended quote feeds the letters.
CREATE TABLE IF NOT EXISTS public.insurance_quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  policy_type text NOT NULL CHECK (policy_type IN ('term', 'whole_life', 'universal_life', 'critical_illness', 'disability', 'long_term_care', 'other')),
  carrier text NOT NULL,
  product text NOT NULL,
  coverage_amount numeric,
  term_years int,
  premium_amount numeric,
  premium_frequency text CHECK (premium_frequency IS NULL OR premium_frequency IN ('monthly', 'quarterly', 'semi_annual', 'annual', 'single')),
  underwriting text,
  riders text,
  guarantees text,
  quote_date date,
  valid_until date,
  illustration_url text,
  notes text,
  status text NOT NULL DEFAULT 'considered' CHECK (status IN ('considered', 'recommended', 'rejected')),
  reason text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_insurance_quotes_contact ON public.insurance_quotes (contact_id, policy_type);
-- One recommended quote per person and kind of cover at a time.
CREATE UNIQUE INDEX IF NOT EXISTS idx_insurance_quotes_one_recommended ON public.insurance_quotes (contact_id, policy_type) WHERE status = 'recommended';

GRANT SELECT, INSERT, UPDATE, DELETE ON public.insurance_quotes TO authenticated;
GRANT ALL ON public.insurance_quotes TO service_role;
ALTER TABLE public.insurance_quotes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Advisors can view insurance quotes" ON public.insurance_quotes FOR SELECT TO authenticated USING (true);
CREATE POLICY "Advisors can add insurance quotes" ON public.insurance_quotes FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Advisors can change insurance quotes" ON public.insurance_quotes FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Advisors can delete insurance quotes" ON public.insurance_quotes FOR DELETE TO authenticated USING (true);
