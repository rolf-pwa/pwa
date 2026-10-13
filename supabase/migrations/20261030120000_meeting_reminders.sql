-- Georgia's meeting reminders (see supabase/functions/_shared/meeting-reminders.ts): one week and one day before a booked
-- meeting, replacing Google's own appointment reminders. Covers meeting types marked "reminders".
--   meeting_types.reminders      which types Georgia reminds about
--   meeting_reminder_config      one row: mode (off | shadow | live) and sending hours
--   meeting_reminders            one row per meeting, person and reminder: the record that stops a double send
-- Service role only.

ALTER TABLE public.meeting_types ADD COLUMN IF NOT EXISTS reminders boolean NOT NULL DEFAULT false;
UPDATE public.meeting_types SET reminders = true WHERE active;

CREATE TABLE IF NOT EXISTS public.meeting_reminder_config (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  mode text NOT NULL DEFAULT 'shadow' CHECK (mode IN ('off', 'shadow', 'live')),
  send_start_hour int NOT NULL DEFAULT 8,
  send_end_hour int NOT NULL DEFAULT 20,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.meeting_reminder_config (id) VALUES (true) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS public.meeting_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id text NOT NULL,
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('7d', '1d')),
  start_time timestamptz NOT NULL,
  mode text NOT NULL CHECK (mode IN ('shadow', 'live')),
  meeting_name text NOT NULL,
  email_ok boolean,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, contact_id, kind, start_time, mode)
);
CREATE INDEX IF NOT EXISTS idx_meeting_reminders_recent ON public.meeting_reminders (created_at DESC);

ALTER TABLE public.meeting_reminder_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_reminders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service manage reminder config" ON public.meeting_reminder_config FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service manage meeting reminders" ON public.meeting_reminders FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT ALL ON public.meeting_reminder_config, public.meeting_reminders TO service_role;

-- Every 30 minutes. The shared secret is a Vault secret named meeting_reminder_cron_secret, created out of band.
SELECT cron.schedule(
  'meeting-reminder-tick',
  '*/30 * * * *',
  $$
  select net.http_post(
    url := 'https://rpxevcovasrgmrzkpknu.supabase.co/functions/v1/meeting-reminder-tick',
    headers := jsonb_build_object(
      'Content-Type', 'application/json', 'x-region', 'ca-central-1',
      'x-meeting-reminder-cron-secret', coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'meeting_reminder_cron_secret'), '')
    ),
    body := '{}'::jsonb
  );
  $$
);
