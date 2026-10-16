-- When a rebalancing is carried out, the death benefit resets in it are recorded here so the pack stops offering them again before the next
-- statement arrives. guaranteed_at_death is the guarantee after the reset (the latest value on the day); a manual edit of the date clears it.
ALTER TABLE public.guarantee_resets
  ADD COLUMN IF NOT EXISTS guaranteed_at_death numeric,
  ADD COLUMN IF NOT EXISTS source text;
