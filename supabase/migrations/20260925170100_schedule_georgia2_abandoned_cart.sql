-- Schedules georgia2-abandoned-cart daily at 16:00 UTC (8-9am Pacific).
-- Modeled on 20260810122000_schedule_retention_review.sql.
--
-- MANUAL STEP REQUIRED before this schedule will actually work (deliberately
-- NOT done here, so no secret value ever enters a migration file / git):
--   1. Generate a random secret, e.g. `openssl rand -hex 32`.
--   2. Set it as an edge function secret:
--        supabase secrets set GEORGIA2_ABANDONED_CART_CRON_SECRET=<value>
--   3. Store the SAME value in Supabase Vault (run once by hand, not as a migration):
--        select vault.create_secret('<value>', 'georgia2_abandoned_cart_cron_secret');
-- Until then the function rejects the blank header (401) and nothing is sent.

select cron.schedule(
  'georgia2-abandoned-cart',
  '0 16 * * *',
  $$
  select net.http_post(
    url := 'https://rpxevcovasrgmrzkpknu.supabase.co/functions/v1/georgia2-abandoned-cart',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-georgia2-cron-secret', coalesce(
        (select decrypted_secret from vault.decrypted_secrets where name = 'georgia2_abandoned_cart_cron_secret'),
        ''
      )
    ),
    body := '{}'::jsonb
  );
  $$
);
