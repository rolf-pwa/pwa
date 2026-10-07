-- The household Tax page: per taxpayer and tax year, the income lines for last year's return (baseline) and the
-- current year's projection, with where each number came from. Staff edit through the household-tax function (service
-- role); the app roles have no direct access.
CREATE TABLE IF NOT EXISTS public.household_tax_columns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  tax_year integer NOT NULL,
  kind text NOT NULL CHECK (kind IN ('baseline', 'projection')),
  province text NOT NULL DEFAULT 'BC',
  lines jsonb NOT NULL DEFAULT '{}'::jsonb,
  sources jsonb NOT NULL DEFAULT '{}'::jsonb,   -- per line: return | detected | manual | baseline
  reported jsonb,                               -- baseline only: totals as printed on the return (total income, taxable income, tax payable)
  source_file text,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_household_tax_columns ON public.household_tax_columns (household_id, contact_id, tax_year, kind);
ALTER TABLE public.household_tax_columns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service manages tax columns" ON public.household_tax_columns FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.household_tax_columns FROM anon, authenticated;
GRANT ALL ON public.household_tax_columns TO service_role;
