-- Drive watcher: records edits made directly in Google Drive (outside the app) in the Vault audit log.
-- State tables are server-only (RLS on, no policies); the function runs as service role.
CREATE TABLE IF NOT EXISTS public.vault_drive_watch (
  id integer PRIMARY KEY CHECK (id = 1),
  page_token text,
  baseline_at timestamptz,
  last_run_at timestamptz,
  last_error text
);
CREATE TABLE IF NOT EXISTS public.vault_drive_state (
  drive_id text PRIMARY KEY,
  household_id uuid REFERENCES public.households(id) ON DELETE SET NULL,
  name text NOT NULL,
  parent_ids text[] NOT NULL DEFAULT '{}',
  trashed boolean NOT NULL DEFAULT false,
  md5 text,
  version text,
  size text,
  mime_type text,
  is_folder boolean NOT NULL DEFAULT false,
  permissions text[] NOT NULL DEFAULT '{}',
  seen_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vault_drive_state_household ON public.vault_drive_state (household_id);
CREATE TABLE IF NOT EXISTS public.vault_drive_folder_map (
  folder_id text PRIMARY KEY,
  household_id uuid,
  checked_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.vault_drive_watch ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vault_drive_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vault_drive_folder_map ENABLE ROW LEVEL SECURITY;

-- Every 10 minutes, pinned to Canada Central like the other scheduled jobs. The shared secret is a Vault secret
-- named vault_drive_watch_cron_secret (created out of band, never in this file).
SELECT cron.schedule(
  'vault-drive-watch',
  '*/10 * * * *',
  $$
  select net.http_post(
    url := 'https://rpxevcovasrgmrzkpknu.supabase.co/functions/v1/vault-drive-watch',
    headers := jsonb_build_object(
      'Content-Type', 'application/json', 'x-region', 'ca-central-1',
      'x-vault-watch-cron-secret', coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'vault_drive_watch_cron_secret'), '')
    ),
    body := '{}'::jsonb
  );
  $$
);
