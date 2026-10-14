-- A Portfolio Review published to a household's portal. The client's view is frozen when Rolf publishes (view), so they always see exactly what
-- was approved; unpublishing hides it without deleting the record.
CREATE TABLE IF NOT EXISTS public.portfolio_review_publications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  published_at timestamptz NOT NULL DEFAULT now(),
  published_by text NOT NULL,
  note text,
  includes jsonb NOT NULL,
  view jsonb NOT NULL,
  unpublished_at timestamptz,
  notified_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_portfolio_review_publications_household ON public.portfolio_review_publications (household_id, published_at DESC);
ALTER TABLE public.portfolio_review_publications ENABLE ROW LEVEL SECURITY;
-- Service role only: written by review-agent-admin (staff) and read by portal-validate (after it has checked the client).
CREATE POLICY "Service manage portfolio review publications" ON public.portfolio_review_publications FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT ALL ON public.portfolio_review_publications TO service_role;
