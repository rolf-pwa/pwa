-- Schedules service-tier-recompute nightly, mirroring
-- 20260810122000_schedule_retention_review.sql's exact pattern.
--
-- MANUAL STEP REQUIRED before this schedule will actually work
-- (deliberately NOT done here, so no secret value ever enters a
-- migration file / git history):
--   1. Generate a random secret, e.g. `openssl rand -hex 32`.
--   2. Set it as an edge function secret:
--        supabase secrets set SERVICE_TIER_CRON_SECRET=<the-random-value>
--   3. Store the SAME value in Supabase Vault, run once by hand in the SQL
--      editor (not as a migration, for the same never-in-git reason):
--        select vault.create_secret('<the-random-value>', 'service_tier_cron_secret');
-- Until step 3 is done, this cron job will call service-tier-recompute with
-- a blank secret header, service-tier-recompute will reject it (401), and
-- the recompute simply won't run until it's configured.

select cron.schedule(
  'service-tier-recompute',
  '0 9 * * *',
  $$
  select net.http_post(
    url := 'https://rpxevcovasrgmrzkpknu.supabase.co/functions/v1/service-tier-recompute',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-service-tier-cron-secret', coalesce(
        (select decrypted_secret from vault.decrypted_secrets where name = 'service_tier_cron_secret'),
        ''
      )
    ),
    body := '{}'::jsonb
  );
  $$
);
