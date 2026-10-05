-- Schedules push-send-drain every minute. Inert until configured, and the
-- drain only pushes for households with v2_ai_engine_enabled = true.
--
-- MANUAL STEPS before this works (deliberately not done here -- no secret
-- ever enters git):
--   1. npx web-push generate-vapid-keys      (or any VAPID P-256 keypair)
--      supabase secrets set VAPID_PUBLIC_KEY=<public> VAPID_PRIVATE_KEY=<private> \
--        VAPID_SUBJECT=mailto:<an ops mailbox>
--   2. openssl rand -hex 32
--      supabase secrets set PUSH_CRON_SECRET=<the-random-value>
--   3. In the SQL editor, once, by hand:
--        select vault.create_secret('<the-random-value>', 'push_cron_secret');
-- Until then the drain returns 401 (or sends nothing) and nothing runs.

select cron.schedule(
  'push-send-drain',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://rpxevcovasrgmrzkpknu.supabase.co/functions/v1/push-send-drain',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-push-cron-secret', coalesce(
        (select decrypted_secret from vault.decrypted_secrets where name = 'push_cron_secret'),
        ''
      )
    ),
    body := '{}'::jsonb
  );
  $$
);
