-- Georgia's onboarding concierge (see supabase/functions/_shared/onboarding-agent.ts).
--   onboarding_agent_config  one row: mode (off | shadow | live) and the limits
--   onboarding_cases         one row per household per mode; the agent's state for that household
--   onboarding_agent_events  an append-only log of every decision and action
-- Service role only: read and changed through edge functions, never from the browser.

CREATE TABLE IF NOT EXISTS public.onboarding_agent_config (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  mode text NOT NULL DEFAULT 'shadow' CHECK (mode IN ('off', 'shadow', 'live')),
  since timestamptz NOT NULL DEFAULT now(),
  max_nudges int NOT NULL DEFAULT 4,
  first_nudge_hours int NOT NULL DEFAULT 24,
  min_gap_hours int NOT NULL DEFAULT 48,
  send_start_hour int NOT NULL DEFAULT 9,
  send_end_hour int NOT NULL DEFAULT 17,
  weekdays_only boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.onboarding_agent_config (id) VALUES (true) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS public.onboarding_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  mode text NOT NULL CHECK (mode IN ('shadow', 'live')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'complete', 'escalated', 'paused')),
  opened_at timestamptz NOT NULL DEFAULT now(),
  nudge_count int NOT NULL DEFAULT 0,
  last_nudge_at timestamptz,
  vault_retries int NOT NULL DEFAULT 0,
  escalated_at timestamptz,
  escalation_reason text,
  escalation_task_id uuid,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (household_id, mode)
);

CREATE TABLE IF NOT EXISTS public.onboarding_agent_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid,
  case_id uuid,
  mode text NOT NULL,
  kind text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_onboarding_events_household ON public.onboarding_agent_events (household_id, created_at DESC);

ALTER TABLE public.onboarding_agent_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.onboarding_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.onboarding_agent_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service manage onboarding config" ON public.onboarding_agent_config FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service manage onboarding cases" ON public.onboarding_cases FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service manage onboarding events" ON public.onboarding_agent_events FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT ALL ON public.onboarding_agent_config, public.onboarding_cases, public.onboarding_agent_events TO service_role;

-- Every 15 minutes. The shared secret is a Vault secret named onboarding_agent_cron_secret, created out of band.
SELECT cron.schedule(
  'onboarding-agent-tick',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'https://rpxevcovasrgmrzkpknu.supabase.co/functions/v1/onboarding-agent-tick',
    headers := jsonb_build_object(
      'Content-Type', 'application/json', 'x-region', 'ca-central-1',
      'x-onboarding-agent-cron-secret', coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'onboarding_agent_cron_secret'), '')
    ),
    body := '{}'::jsonb
  );
  $$
);
