-- Georgia's review windows (see supabase/functions/_shared/review-windows.ts): each family is owed meetings by tier; each
-- has a window. Georgia invites both adults on the first day, reminds every three weeks, and hands over near the end.
--   review_agent_config    one row: mode (off | shadow | live) and the limits
--   review_obligations     one row per family per meeting window per mode
--   review_agent_events    append-only log of every decision and action
-- Service role only: read and changed through edge functions.

CREATE TABLE IF NOT EXISTS public.review_agent_config (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  mode text NOT NULL DEFAULT 'shadow' CHECK (mode IN ('off', 'shadow', 'live')),
  since timestamptz NOT NULL DEFAULT now(),
  remind_every_days int NOT NULL DEFAULT 21,
  handoff_days_before_end int NOT NULL DEFAULT 21,
  max_nudges int NOT NULL DEFAULT 4,
  send_start_hour int NOT NULL DEFAULT 9,
  send_end_hour int NOT NULL DEFAULT 17,
  weekdays_only boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.review_agent_config (id) VALUES (true) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS public.review_obligations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('annual_review', 'sovereignty_review', 'governance_review')),
  window_key text NOT NULL,
  window_start date NOT NULL,
  window_end date NOT NULL,
  tier text,
  mode text NOT NULL CHECK (mode IN ('shadow', 'live')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'booked', 'held', 'escalated', 'paused', 'cancelled')),
  booked_event_id text,
  booked_start timestamptz,
  nudge_count int NOT NULL DEFAULT 0,
  last_nudge_at timestamptz,
  snoozed_until timestamptz,
  thread_ids text[] NOT NULL DEFAULT '{}',
  sent_message_ids text[] NOT NULL DEFAULT '{}',
  handled_message_ids text[] NOT NULL DEFAULT '{}',
  escalation_reason text,
  escalation_task_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (family_id, window_key, mode)
);
CREATE INDEX IF NOT EXISTS idx_review_obligations_active ON public.review_obligations (mode, status, window_end);

CREATE TABLE IF NOT EXISTS public.review_agent_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid,
  obligation_id uuid,
  mode text NOT NULL,
  kind text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_review_events_family ON public.review_agent_events (family_id, created_at DESC);

ALTER TABLE public.review_agent_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.review_obligations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.review_agent_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service manage review config" ON public.review_agent_config FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service manage review obligations" ON public.review_obligations FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service manage review events" ON public.review_agent_events FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT ALL ON public.review_agent_config, public.review_obligations, public.review_agent_events TO service_role;

-- Every 30 minutes. The shared secret is a Vault secret named review_agent_cron_secret, created out of band.
SELECT cron.schedule(
  'review-agent-tick',
  '*/30 * * * *',
  $$
  select net.http_post(
    url := 'https://rpxevcovasrgmrzkpknu.supabase.co/functions/v1/review-agent-tick',
    headers := jsonb_build_object(
      'Content-Type', 'application/json', 'x-region', 'ca-central-1',
      'x-review-agent-cron-secret', coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'review_agent_cron_secret'), '')
    ),
    body := '{}'::jsonb
  );
  $$
);
