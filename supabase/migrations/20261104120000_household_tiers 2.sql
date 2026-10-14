-- Without a ratified Charter (and outside a Virtual Family Office) nothing binds a family's households together, so each household
-- is tiered on its own assets and owes its own meetings. Pooled families (charter, VFO, or a manual override) are unchanged.
ALTER TABLE public.households
  ADD COLUMN IF NOT EXISTS service_tier text,
  ADD COLUMN IF NOT EXISTS grouped_aum_cad numeric;
COMMENT ON COLUMN public.households.service_tier IS 'Set only for a household that is tiered on its own (its family has no ratified Charter and is not a VFO). Null means the family tier applies.';

ALTER TABLE public.review_obligations
  ADD COLUMN IF NOT EXISTS household_id uuid REFERENCES public.households(id) ON DELETE CASCADE;
COMMENT ON COLUMN public.review_obligations.household_id IS 'Set when the meeting is owed by a single household (unchartered family). Null: owed by the whole family.';

ALTER TABLE public.review_obligations DROP CONSTRAINT IF EXISTS review_obligations_family_id_window_key_mode_key;
DROP INDEX IF EXISTS public.review_obligations_family_id_window_key_mode_key;
CREATE UNIQUE INDEX IF NOT EXISTS review_obligations_unit_window_mode
  ON public.review_obligations (family_id, COALESCE(household_id, '00000000-0000-0000-0000-000000000000'::uuid), window_key, mode);
