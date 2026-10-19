-- The inbox sweep runs every morning at 4:30 Pacific, before the briefing is made at 5:30, so the briefing can say what it found.
-- Still read-only. inbox_sweep_config.auto is the off switch (also on the Ask Georgia page).
CREATE TABLE IF NOT EXISTS public.inbox_sweep_config (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  auto boolean NOT NULL DEFAULT true
);
INSERT INTO public.inbox_sweep_config (id) VALUES (true) ON CONFLICT DO NOTHING;
ALTER TABLE public.inbox_sweep_config ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.inbox_sweep_config TO service_role;

-- Two schedule entries cover winter and summer time (11:30 and 12:30 UTC); only the one that falls at 4:30 Pacific acts.
SELECT cron.schedule(
  'inbox-sweep-morning-a',
  '30 11 * * *',
  $$
  select net.http_post(
    url := 'https://rpxevcovasrgmrzkpknu.supabase.co/functions/v1/daily-briefing-generate',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-daily-briefing-cron-secret', coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'daily_briefing_cron_secret'), '')),
    body := '{"job":"inbox_sweep_morning","onlyAtPacificHour":4}'::jsonb
  );
  $$
);
SELECT cron.schedule(
  'inbox-sweep-morning-b',
  '30 12 * * *',
  $$
  select net.http_post(
    url := 'https://rpxevcovasrgmrzkpknu.supabase.co/functions/v1/daily-briefing-generate',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-daily-briefing-cron-secret', coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'daily_briefing_cron_secret'), '')),
    body := '{"job":"inbox_sweep_morning","onlyAtPacificHour":4}'::jsonb
  );
  $$
);
