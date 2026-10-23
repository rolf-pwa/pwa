-- Call recordings copied to the client's Advisor Files / Call Recordings, with a transcript made by our own AI (Vertex, Montreal) saved beside them.
-- Callizy keeps its copy; nothing is moved or deleted. Calls from numbers that are not a matched client with a Vault folder are left until they are.
ALTER TABLE public.quo_calls
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS recording_drive_id text,
  ADD COLUMN IF NOT EXISTS recording_drive_url text,
  ADD COLUMN IF NOT EXISTS transcript_drive_url text,
  ADD COLUMN IF NOT EXISTS transcript_source text,
  ADD COLUMN IF NOT EXISTS archive_note text,
  ADD COLUMN IF NOT EXISTS archive_attempts int NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_quo_calls_unarchived ON public.quo_calls (occurred_at DESC) WHERE archived_at IS NULL AND provider = 'callizy';

-- Overnight, every ten minutes between 3 and 6 am Pacific (summer time; 2 to 5 am in winter): a few calls at a time, newest first, until none are left.
SELECT cron.schedule(
  'call-archive',
  '*/10 10-12 * * *',
  $$
  select net.http_post(
    url := 'https://rpxevcovasrgmrzkpknu.supabase.co/functions/v1/daily-briefing-generate',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-daily-briefing-cron-secret', coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'daily_briefing_cron_secret'), '')),
    body := '{"job":"call_archive"}'::jsonb
  );
  $$
);
