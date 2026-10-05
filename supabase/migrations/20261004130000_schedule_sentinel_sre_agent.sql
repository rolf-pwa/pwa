-- Schedules the V2 Sentinel SRE agent every 2 minutes. Modeled on
-- 20260810122000_schedule_retention_review.sql; pg_cron + pg_net are already
-- enabled. The agent only touches rows for households with
-- v2_ai_engine_enabled = true (plus rows with no household), so scheduling it
-- is inert for V1 households.
--
-- MANUAL STEP REQUIRED before this schedule works (deliberately not done
-- here, so no secret ever enters git):
--   1. openssl rand -hex 32
--   2. supabase secrets set SENTINEL_CRON_SECRET=<the-random-value>
--   3. In the SQL editor, once, by hand:
--        select vault.create_secret('<the-random-value>', 'sentinel_cron_secret');
-- Until step 3, the agent returns 401 and nothing runs.

select cron.schedule(
  'sentinel-sre-agent',
  '*/2 * * * *',
  $$
  select net.http_post(
    url := 'https://rpxevcovasrgmrzkpknu.supabase.co/functions/v1/sentinel-sre-agent',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-sentinel-cron-secret', coalesce(
        (select decrypted_secret from vault.decrypted_secrets where name = 'sentinel_cron_secret'),
        ''
      )
    ),
    body := '{}'::jsonb
  );
  $$
);
