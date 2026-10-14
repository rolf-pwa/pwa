-- Date of birth on the contact (the age-85 cut-off for death benefit resets depends on it).
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS date_of_birth date;

-- The last time a segregated fund account's death benefit guarantee was reset (entered by staff; the statement's "guaranteed value at death" is the last reset amount).
CREATE TABLE IF NOT EXISTS public.guarantee_resets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  account_number text NOT NULL,
  last_reset_date date,
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (household_id, account_number)
);
ALTER TABLE public.guarantee_resets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service manage guarantee resets" ON public.guarantee_resets FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT ALL ON public.guarantee_resets TO service_role;

-- iA measures an account against its profile on a hard line, so the default tolerance is none (compared to the nearest whole point).
ALTER TABLE public.investor_profiles ALTER COLUMN band_pct SET DEFAULT 0;
UPDATE public.investor_profiles SET band_pct = 0 WHERE band_pct = 5;
