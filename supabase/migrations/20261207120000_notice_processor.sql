-- Georgia handles iA and Adobe Sign notices on her own (every 30 minutes): each notice is looked at once.
CREATE TABLE IF NOT EXISTS public.notice_seen (
  message_id text PRIMARY KEY,
  outcome text NOT NULL CHECK (outcome IN ('commented', 'closed', 'flagged', 'skipped')),
  task_id uuid,
  seen_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.notice_seen ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.notice_seen TO service_role;

SELECT cron.schedule(
  'notice-processor',
  '*/30 * * * *',
  $$
  select net.http_post(
    url := 'https://rpxevcovasrgmrzkpknu.supabase.co/functions/v1/daily-briefing-generate',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-daily-briefing-cron-secret', coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'daily_briefing_cron_secret'), '')),
    body := '{"job":"notice_processor"}'::jsonb
  );
  $$
);
