-- The morning briefing: the lists shown under the priorities (schedule, week ahead, replies, iA and Adobe Sign items, texts, firm exceptions) are
-- built in code and stored here, and the schedule now keeps Pacific time: the briefing is ready by 6:00 in winter and summer.
ALTER TABLE public.daily_briefings ADD COLUMN IF NOT EXISTS sections jsonb;

-- Two runs, one of which acts: the function only generates when it is 5am Pacific (12:30 UTC in summer, 13:30 UTC in winter).
SELECT cron.unschedule('daily-briefing-generate');
SELECT cron.schedule(
  'daily-briefing-generate-0530-pt-a',
  '30 12 * * *',
  $$
  select net.http_post(
    url := 'https://rpxevcovasrgmrzkpknu.supabase.co/functions/v1/daily-briefing-generate',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-daily-briefing-cron-secret', coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'daily_briefing_cron_secret'), '')),
    body := '{"onlyAtPacificHour":5}'::jsonb
  );
  $$
);
SELECT cron.schedule(
  'daily-briefing-generate-0530-pt-b',
  '30 13 * * *',
  $$
  select net.http_post(
    url := 'https://rpxevcovasrgmrzkpknu.supabase.co/functions/v1/daily-briefing-generate',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-daily-briefing-cron-secret', coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'daily_briefing_cron_secret'), '')),
    body := '{"onlyAtPacificHour":5}'::jsonb
  );
  $$
);
