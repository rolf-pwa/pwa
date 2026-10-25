-- Push notifications to the phone: the devices that asked for them, and the triggers that tell the briefing function when something buzzes.
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint text NOT NULL UNIQUE,
  p256dh text NOT NULL,
  auth text NOT NULL,
  user_agent text,
  categories text[] NOT NULL DEFAULT ARRAY['texts','calls','requests','documents','alerts'],
  quiet boolean NOT NULL DEFAULT true,
  last_sent_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.push_subscriptions TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.push_subscriptions TO authenticated;
CREATE POLICY "Staff manage their own push subscriptions" ON public.push_subscriptions FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- Tell the briefing function about a new notification or text. A failure here must never stop the row being saved.
CREATE OR REPLACE FUNCTION public.push_ping(job text, body jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM net.http_post(
    url := 'https://rpxevcovasrgmrzkpknu.supabase.co/functions/v1/daily-briefing-generate',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-daily-briefing-cron-secret', coalesce((SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'daily_briefing_cron_secret'), '')),
    body := jsonb_build_object('job', job) || body
  );
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'push_ping failed: %', SQLERRM;
END $$;

CREATE OR REPLACE FUNCTION public.push_on_staff_notification() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.source_type IN ('urgent_text','voicemail','new_request','request_message','ask_georgia_flag','task_client_reply','insurance_document','system_error') THEN
    PERFORM public.push_ping('push_notify', jsonb_build_object('kind', 'staff', 'id', NEW.id));
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_push_staff_notification ON public.staff_notifications;
CREATE TRIGGER trg_push_staff_notification AFTER INSERT ON public.staff_notifications FOR EACH ROW EXECUTE FUNCTION public.push_on_staff_notification();

-- Only fresh texts: an import or a backfill must not buzz the phone for old messages.
CREATE OR REPLACE FUNCTION public.push_on_inbound_text() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.direction = 'inbound' AND NEW.occurred_at > now() - interval '10 minutes' THEN
    PERFORM public.push_ping('push_notify', jsonb_build_object('kind', 'text', 'id', NEW.id));
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_push_inbound_text ON public.quo_messages;
CREATE TRIGGER trg_push_inbound_text AFTER INSERT ON public.quo_messages FOR EACH ROW EXECUTE FUNCTION public.push_on_inbound_text();
