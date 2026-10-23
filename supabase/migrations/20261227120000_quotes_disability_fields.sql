-- Disability quotes carry the monthly benefit (in coverage_amount), the waiting period, benefit period and occupation definition, and are either income cover or
-- business overhead expense (BOE) cover. A person can have one recommended quote of each, so the one-recommended rule now includes the kind.
ALTER TABLE public.insurance_quotes
  ADD COLUMN IF NOT EXISTS benefit_kind text CHECK (benefit_kind IS NULL OR benefit_kind IN ('income', 'overhead')),
  ADD COLUMN IF NOT EXISTS waiting_days int,
  ADD COLUMN IF NOT EXISTS benefit_period text,
  ADD COLUMN IF NOT EXISTS occupation text;
DROP INDEX IF EXISTS public.idx_insurance_quotes_one_recommended;
CREATE UNIQUE INDEX IF NOT EXISTS idx_insurance_quotes_one_recommended ON public.insurance_quotes (contact_id, policy_type, (COALESCE(benefit_kind, 'income'))) WHERE status = 'recommended';
