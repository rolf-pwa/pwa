-- The monthly performance import, run by Georgia: she watches a Drive folder, prepares each month's file, reminds Rolf to download it,
-- and records every import (hers or a person's) with what it replaced, so a bad month can be undone.
--   mode  off      Georgia does nothing
--         prepare  Georgia reads a new file and shows the preview; a person commits it
--         auto     as prepare, and a file that passes every check commits its routine rows by itself (exceptions always wait)

CREATE TABLE IF NOT EXISTS public.monthly_import_config (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  mode text NOT NULL DEFAULT 'prepare' CHECK (mode IN ('off', 'prepare', 'auto')),
  drive_folder_id text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.monthly_import_config (id, mode, drive_folder_id) VALUES (true, 'prepare', '1rAtN9cu-x_0LEp4DIpq5DOQS_JAzuygM') ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.monthly_import_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  drive_file_id text UNIQUE,
  file_name text,
  snapshot_date date NOT NULL,
  source text NOT NULL DEFAULT 'georgia' CHECK (source IN ('georgia', 'manual')),
  status text NOT NULL CHECK (status IN ('ready', 'held', 'committed', 'undone', 'error')),
  checks jsonb NOT NULL DEFAULT '[]'::jsonb,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  rows jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  committed_at timestamptz,
  committed_by text,
  undone_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_monthly_import_runs_date ON public.monthly_import_runs (snapshot_date DESC);

-- What a committed import replaced, so it can be put back.
CREATE TABLE IF NOT EXISTS public.monthly_import_undo (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.monthly_import_runs(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('account', 'snapshot_created', 'snapshot_replaced', 'account_created')),
  table_name text NOT NULL,
  row_id uuid NOT NULL,
  previous jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_monthly_import_undo_run ON public.monthly_import_undo (run_id);

CREATE TABLE IF NOT EXISTS public.monthly_import_reminders (
  month text PRIMARY KEY,
  download_sent_at timestamptz,
  late_sent_at timestamptz
);

ALTER TABLE public.monthly_import_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.monthly_import_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.monthly_import_undo ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.monthly_import_reminders ENABLE ROW LEVEL SECURITY;
-- Service role only: staff read and change these through the import function.
CREATE POLICY "Service manage monthly import config" ON public.monthly_import_config FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service manage monthly import runs" ON public.monthly_import_runs FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service manage monthly import undo" ON public.monthly_import_undo FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service manage monthly import reminders" ON public.monthly_import_reminders FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT ALL ON public.monthly_import_config TO service_role;
GRANT ALL ON public.monthly_import_runs TO service_role;
GRANT ALL ON public.monthly_import_undo TO service_role;
GRANT ALL ON public.monthly_import_reminders TO service_role;

-- This month's reminders are not needed: the October file was imported by hand before Georgia took over.
INSERT INTO public.monthly_import_reminders (month, download_sent_at, late_sent_at)
VALUES (to_char(now() AT TIME ZONE 'America/Vancouver', 'YYYY-MM'), now(), now()) ON CONFLICT (month) DO NOTHING;

-- Every 30 minutes: look for a new file, and remind on the first business day. The shared secret is a Vault secret named
-- monthly_import_cron_secret, created out of band.
SELECT cron.schedule(
  'monthly-import-watch',
  '*/30 * * * *',
  $$
  select net.http_post(
    url := 'https://rpxevcovasrgmrzkpknu.supabase.co/functions/v1/bulk-import-performance',
    headers := jsonb_build_object(
      'Content-Type', 'application/json', 'x-region', 'ca-central-1',
      'x-monthly-import-cron-secret', coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'monthly_import_cron_secret'), '')
    ),
    body := '{"action":"watch"}'::jsonb
  );
  $$
);
