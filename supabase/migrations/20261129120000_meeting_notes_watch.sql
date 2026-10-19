-- Georgia drafts the follow-up when new Google Meet notes appear.
--   pm_tasks.staff_notes        what Georgia wants Rolf to check on a draft; never sent to clients or professionals (their screens ask for named columns)
--   meeting_notes_seen          each "Notes by Gemini" document, handled once
--   meeting_notes_config        on/off, and when it went live (only notes created after that are handled automatically)
ALTER TABLE public.pm_tasks ADD COLUMN IF NOT EXISTS staff_notes text;

CREATE TABLE IF NOT EXISTS public.meeting_notes_seen (
  doc_id text PRIMARY KEY,
  doc_name text NOT NULL,
  doc_created_at timestamptz,
  status text NOT NULL CHECK (status IN ('drafted', 'unmatched', 'internal', 'skipped', 'failed')),
  task_id uuid REFERENCES public.pm_tasks(id) ON DELETE SET NULL,
  reason text,
  attempts integer NOT NULL DEFAULT 0,
  processed_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.meeting_notes_seen ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.meeting_notes_seen TO service_role;

CREATE TABLE IF NOT EXISTS public.meeting_notes_config (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  enabled boolean NOT NULL DEFAULT true,
  go_live_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.meeting_notes_config (id) VALUES (true) ON CONFLICT DO NOTHING;
ALTER TABLE public.meeting_notes_config ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.meeting_notes_config TO service_role;

-- Every 15 minutes (the function handles one document per run).
SELECT cron.schedule(
  'meeting-notes-scan',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'https://rpxevcovasrgmrzkpknu.supabase.co/functions/v1/daily-briefing-generate',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-daily-briefing-cron-secret', coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'daily_briefing_cron_secret'), '')),
    body := '{"job":"meeting_notes_scan"}'::jsonb
  );
  $$
);
