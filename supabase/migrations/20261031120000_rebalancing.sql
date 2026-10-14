-- Portfolio rebalancing by acknowledgement (see _shared/review-windows.ts): Tier 1 in Q3, Tier 2A in Q4. Georgia tracks it in
-- review_obligations like a meeting (invitation on the first day, reminders, hand-off), but it is completed by the client's
-- acknowledgement in the portal, which is recorded in rebalance_acknowledgements with the exact wording shown.
DO $$
DECLARE c text;
BEGIN
  SELECT conname INTO c FROM pg_constraint
   WHERE conrelid = 'public.review_obligations'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%annual_review%';
  IF c IS NOT NULL THEN EXECUTE format('ALTER TABLE public.review_obligations DROP CONSTRAINT %I', c); END IF;
END $$;
ALTER TABLE public.review_obligations
  ADD CONSTRAINT review_obligations_kind_check CHECK (kind IN ('annual_review', 'sovereignty_review', 'governance_review', 'rebalancing'));
ALTER TABLE public.review_obligations ADD COLUMN IF NOT EXISTS acknowledged_at timestamptz;

CREATE TABLE IF NOT EXISTS public.rebalance_acknowledgements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  obligation_id uuid NOT NULL REFERENCES public.review_obligations(id) ON DELETE CASCADE,
  family_id uuid NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  decision text NOT NULL CHECK (decision IN ('acknowledged', 'wants_meeting')),
  statement_version text NOT NULL,
  statement_text text NOT NULL,
  ip text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rebalance_ack_obligation ON public.rebalance_acknowledgements (obligation_id);
ALTER TABLE public.rebalance_acknowledgements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service manage rebalance acknowledgements" ON public.rebalance_acknowledgements FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT ALL ON public.rebalance_acknowledgements TO service_role;
