-- Georgia as Rolf's executive assistant: the morning meeting is a chat, what she does in it is recorded, and what she is told to remember is kept.
--   ea_messages     the conversation, one thread per staff member per day
--   ea_actions      every tool Georgia used (a task made, a search run) and every draft or proposal waiting for Rolf (an email, a calendar event)
--   ea_preferences  things she has been asked to remember, such as a sender to stop showing

CREATE TABLE IF NOT EXISTS public.ea_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  conversation_date date NOT NULL,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ea_messages_thread ON public.ea_messages (staff_user_id, conversation_date, created_at);

CREATE TABLE IF NOT EXISTS public.ea_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  message_id uuid REFERENCES public.ea_messages(id) ON DELETE SET NULL,
  conversation_date date NOT NULL,
  kind text NOT NULL,
  status text NOT NULL CHECK (status IN ('done', 'proposed', 'dismissed', 'failed')),
  summary text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_ea_actions_thread ON public.ea_actions (staff_user_id, conversation_date, created_at);

CREATE TABLE IF NOT EXISTS public.ea_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('mute_sender', 'note')),
  value text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ea_preferences_staff ON public.ea_preferences (staff_user_id) WHERE active;

ALTER TABLE public.ea_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ea_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ea_preferences ENABLE ROW LEVEL SECURITY;
-- Each person reads only their own; everything is written through the function (service role).
CREATE POLICY "Own ea messages" ON public.ea_messages FOR SELECT TO authenticated USING (staff_user_id = auth.uid());
CREATE POLICY "Own ea actions" ON public.ea_actions FOR SELECT TO authenticated USING (staff_user_id = auth.uid());
CREATE POLICY "Own ea preferences" ON public.ea_preferences FOR SELECT TO authenticated USING (staff_user_id = auth.uid());
CREATE POLICY "Service manage ea messages" ON public.ea_messages FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service manage ea actions" ON public.ea_actions FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service manage ea preferences" ON public.ea_preferences FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT SELECT ON public.ea_messages, public.ea_actions, public.ea_preferences TO authenticated;
GRANT ALL ON public.ea_messages, public.ea_actions, public.ea_preferences TO service_role;

-- A nudge at 9:00 Pacific: "your morning meeting is ready". Two entries cover winter and summer time; the function acts only at 9am Pacific.
SELECT cron.schedule(
  'ea-meeting-nudge-a',
  '0 16 * * 1-5',
  $$
  select net.http_post(
    url := 'https://rpxevcovasrgmrzkpknu.supabase.co/functions/v1/daily-briefing-generate',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-daily-briefing-cron-secret', coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'daily_briefing_cron_secret'), '')),
    body := '{"nudge":true,"onlyAtPacificHour":9}'::jsonb
  );
  $$
);
SELECT cron.schedule(
  'ea-meeting-nudge-b',
  '0 17 * * 1-5',
  $$
  select net.http_post(
    url := 'https://rpxevcovasrgmrzkpknu.supabase.co/functions/v1/daily-briefing-generate',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-daily-briefing-cron-secret', coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'daily_briefing_cron_secret'), '')),
    body := '{"nudge":true,"onlyAtPacificHour":9}'::jsonb
  );
  $$
);
