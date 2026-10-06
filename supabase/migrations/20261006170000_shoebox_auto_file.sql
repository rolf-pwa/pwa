-- Shoebox auto-file: a scheduled scan classifies new Shoebox files and, only for households that
-- opt in and only when every field was read off the document itself, renames and files them.
-- Anything less certain stays a pending proposal for staff. Strictly additive.
ALTER TABLE public.households
  ADD COLUMN IF NOT EXISTS shoebox_auto_file_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE public.vault_shoebox_proposals
  ADD COLUMN IF NOT EXISTS auto_filed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS auto_filed_at timestamptz,
  ADD COLUMN IF NOT EXISTS undone_at timestamptz;

-- Runs vault-service's cron-only autoFileShoebox action every 15 minutes.
--
-- MANUAL STEP REQUIRED before this schedule does anything (no secret value ever enters git):
--   1. supabase secrets set SHOEBOX_AUTO_FILE_CRON_SECRET=<value>
--   2. select vault.create_secret('<same value>', 'shoebox_auto_file_cron_secret');
-- Until then the function rejects the blank header (401). Even once it runs, it only touches
-- households with shoebox_auto_file_enabled = true (default false).
select cron.schedule(
  'shoebox-auto-file',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'https://rpxevcovasrgmrzkpknu.supabase.co/functions/v1/vault-service',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-shoebox-cron-secret', coalesce(
        (select decrypted_secret from vault.decrypted_secrets where name = 'shoebox_auto_file_cron_secret'),
        ''
      )
    ),
    body := '{"action":"autoFileShoebox"}'::jsonb
  );
  $$
);
