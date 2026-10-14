-- The target mix from a client's Investor Profile, used by the Portfolio Review pack. One row per household (account_number null) or per
-- account. Entered by staff for now; later read from the profile document in the client's Investment folder (source = 'vault').
CREATE TABLE IF NOT EXISTS public.investor_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  account_number text,
  label text,
  income_pct numeric CHECK (income_pct IS NULL OR (income_pct >= 0 AND income_pct <= 100)),
  equity_pct numeric CHECK (equity_pct IS NULL OR (equity_pct >= 0 AND equity_pct <= 100)),
  band_pct numeric NOT NULL DEFAULT 5 CHECK (band_pct >= 0 AND band_pct <= 50),
  source text NOT NULL DEFAULT 'manual',
  source_file text,
  as_of date,
  updated_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS investor_profiles_unit ON public.investor_profiles (household_id, COALESCE(account_number, ''));
ALTER TABLE public.investor_profiles ENABLE ROW LEVEL SECURITY;
-- Service role only: read and written through review-agent-admin, which checks the caller is staff.
CREATE POLICY "Service manage investor profiles" ON public.investor_profiles FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT ALL ON public.investor_profiles TO service_role;
