-- Book-of-business opportunities: what the weekly diagnostic finds, kept so staff can accept, dismiss or snooze each one.
-- One row per (household, type, key); a run updates the row rather than adding another. A finding that stops firing is marked
-- resolved, never deleted. Staff only (a @prosperwise.ca login); the weekly run writes with the service role.
CREATE TABLE IF NOT EXISTS public.opportunities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('insurance_coverage_gap', 'debt_protection', 'charter_candidate', 'tier_upgrade', 'consolidation', 'corporate_structuring', 'estate_gap', 'idle_cash', 'policy_event')),
  key text NOT NULL,
  title text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  confidence text NOT NULL CHECK (confidence IN ('high', 'medium', 'low')),
  next_step text,
  est_value numeric,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'snoozed', 'dismissed', 'converted', 'resolved')),
  snoozed_until date,
  dismissed_reason text,
  decided_by text,
  decided_at timestamptz,
  converted_at timestamptz,
  resolved_at timestamptz,
  rule_version text NOT NULL,
  first_seen date NOT NULL DEFAULT current_date,
  last_seen date NOT NULL DEFAULT current_date,
  UNIQUE (household_id, type, key)
);
CREATE INDEX IF NOT EXISTS idx_opportunities_status ON public.opportunities (status);
CREATE INDEX IF NOT EXISTS idx_opportunities_household ON public.opportunities (household_id);

-- One row per run: the summary, and each household's completeness and missing data (not kept per finding, so it is a snapshot).
CREATE TABLE IF NOT EXISTS public.opportunity_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  ok boolean,
  rule_version text,
  summary jsonb,
  households jsonb
);
CREATE INDEX IF NOT EXISTS idx_opportunity_runs_started ON public.opportunity_runs (started_at DESC);

DROP TRIGGER IF EXISTS update_opportunities_updated_at ON public.opportunities;
CREATE TRIGGER update_opportunities_updated_at BEFORE UPDATE ON public.opportunities FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.opportunities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.opportunity_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff view opportunities" ON public.opportunities FOR SELECT TO authenticated
  USING (lower(coalesce(auth.jwt() ->> 'email', '')) LIKE '%@prosperwise.ca');
CREATE POLICY "Staff decide opportunities" ON public.opportunities FOR UPDATE TO authenticated
  USING (lower(coalesce(auth.jwt() ->> 'email', '')) LIKE '%@prosperwise.ca')
  WITH CHECK (lower(coalesce(auth.jwt() ->> 'email', '')) LIKE '%@prosperwise.ca');
CREATE POLICY "Staff view opportunity runs" ON public.opportunity_runs FOR SELECT TO authenticated
  USING (lower(coalesce(auth.jwt() ->> 'email', '')) LIKE '%@prosperwise.ca');
CREATE POLICY "Service manages opportunities" ON public.opportunities FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service manages opportunity runs" ON public.opportunity_runs FOR ALL TO service_role USING (true) WITH CHECK (true);
-- Staff can read and update (to accept, dismiss or snooze); only the run adds or removes rows. Default privileges also hand out TRUNCATE, which RLS does not stop.
REVOKE ALL ON public.opportunities, public.opportunity_runs FROM anon, authenticated;
GRANT SELECT, UPDATE ON public.opportunities TO authenticated;
GRANT SELECT ON public.opportunity_runs TO authenticated;
GRANT ALL ON public.opportunities, public.opportunity_runs TO service_role;

-- Every Monday at 5 am Pacific (summer time; 4 am in winter): Georgia's weekly book-of-business run.
SELECT cron.schedule(
  'book-of-business-weekly',
  '0 12 * * 1',
  $$
  select net.http_post(
    url := 'https://rpxevcovasrgmrzkpknu.supabase.co/functions/v1/daily-briefing-generate',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-daily-briefing-cron-secret', coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'daily_briefing_cron_secret'), '')),
    body := '{"job":"book_of_business"}'::jsonb
  );
  $$
);
