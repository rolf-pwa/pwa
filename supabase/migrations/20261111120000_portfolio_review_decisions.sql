-- A client's response to the proposal on their published Portfolio Review: which items they acknowledged and authorized (with the exact wording
-- shown), or that they want to talk it through first. Kept as the record of consent.
CREATE TABLE IF NOT EXISTS public.portfolio_review_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  publication_id uuid NOT NULL REFERENCES public.portfolio_review_publications(id) ON DELETE CASCADE,
  household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  decision text NOT NULL CHECK (decision IN ('authorized', 'talk_first')),
  item_ids text[] NOT NULL DEFAULT '{}',
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  statement_version text,
  statement_text text,
  ip text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_portfolio_review_decisions_publication ON public.portfolio_review_decisions (publication_id, created_at DESC);
ALTER TABLE public.portfolio_review_decisions ENABLE ROW LEVEL SECURITY;
-- Service role only: written by portal-rebalance after it has checked the client, read by portal-validate and review-agent-admin.
CREATE POLICY "Service manage portfolio review decisions" ON public.portfolio_review_decisions FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT ALL ON public.portfolio_review_decisions TO service_role;
