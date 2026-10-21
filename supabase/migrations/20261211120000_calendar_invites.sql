-- Georgia looks at calendar invitations Rolf has not answered every 30 minutes; each is looked at once.
CREATE TABLE IF NOT EXISTS public.calendar_invites_seen (
  event_id text PRIMARY KEY,
  outcome text NOT NULL CHECK (outcome IN ('accepted', 'flagged')),
  seen_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.calendar_invites_seen ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.calendar_invites_seen TO service_role;

SELECT cron.schedule(
  'calendar-invites',
  '*/30 * * * *',
  $$
  select net.http_post(
    url := 'https://rpxevcovasrgmrzkpknu.supabase.co/functions/v1/daily-briefing-generate',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-daily-briefing-cron-secret', coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'daily_briefing_cron_secret'), '')),
    body := '{"job":"calendar_invites"}'::jsonb
  );
  $$
);
