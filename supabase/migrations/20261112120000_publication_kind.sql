-- A published page is either the Portfolio Review (Tier 2) or the Tier 1 rebalancing, which uses the same page and pack but shows fewer sections
-- and lets the client authorize the proposal. A rebalance is tied to the household's rebalancing obligation, so Georgia's reminders, the
-- "to carry out" step and the task for Rolf keep working.
ALTER TABLE public.portfolio_review_publications
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'review' CHECK (kind IN ('review', 'rebalance')),
  ADD COLUMN IF NOT EXISTS obligation_id uuid REFERENCES public.review_obligations(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_portfolio_review_publications_kind ON public.portfolio_review_publications (household_id, kind, published_at DESC);
