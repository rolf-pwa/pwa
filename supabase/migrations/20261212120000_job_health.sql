-- Heartbeats for Georgia's scheduled jobs, and a watchdog (every 30 minutes) that alerts Rolf in the app when one is late or failing.
CREATE TABLE IF NOT EXISTS public.job_heartbeats (
  job text PRIMARY KEY,
  last_finished timestamptz,
  last_ok boolean,
  last_error text,
  last_summary text,
  alerted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.job_heartbeats ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.job_heartbeats TO service_role;

SELECT cron.schedule(
  'health-watchdog',
  '*/30 * * * *',
  $$
  select net.http_post(
    url := 'https://rpxevcovasrgmrzkpknu.supabase.co/functions/v1/daily-briefing-generate',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-daily-briefing-cron-secret', coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'daily_briefing_cron_secret'), '')),
    body := '{"job":"health_watchdog"}'::jsonb
  );
  $$
);
