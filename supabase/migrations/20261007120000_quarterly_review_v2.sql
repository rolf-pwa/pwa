-- Quarterly Review v2: per-household, per-quarter review in the Stabilization Map document format.
-- Strictly additive. Reviews created by the old layout keep layout_version = 1 and still open.
ALTER TABLE public.quarterly_system_reviews
  ADD COLUMN IF NOT EXISTS household_id uuid REFERENCES public.households(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS period_label text,
  ADD COLUMN IF NOT EXISTS layout_version int NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS diagnostics jsonb,
  ADD COLUMN IF NOT EXISTS alignment_cards jsonb,
  ADD COLUMN IF NOT EXISTS action_plan jsonb,
  ADD COLUMN IF NOT EXISTS urgency_flag text,
  ADD COLUMN IF NOT EXISTS charter_alignment text,
  -- 'quarterly' = chartered household (alignment review); 'survey' = no ratified Charter (Sovereignty Survey).
  ADD COLUMN IF NOT EXISTS review_mode text NOT NULL DEFAULT 'quarterly' CHECK (review_mode IN ('quarterly','survey'));

-- One review per household per quarter: regenerating within a quarter updates it, a new quarter adds a new one.
CREATE UNIQUE INDEX IF NOT EXISTS uq_quarterly_system_reviews_household_period
  ON public.quarterly_system_reviews (household_id, period_label) WHERE household_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_quarterly_system_reviews_household
  ON public.quarterly_system_reviews (household_id, review_date DESC);
