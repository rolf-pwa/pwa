-- Held-back tables for the mobile/training release: Action Brain events, de-identified training
-- trajectories and Web Push subscriptions (created here in their original shape), followed by the
-- client-push changes (contact-owned subscriptions, push_deliveries). Same final schema as the full
-- feature/v2-ai-engine-mobile-pwa branch. Strictly additive.

-- ---------------------------------------------------------------------------
-- 5. action_brain_events (episodic stream of AI proposal vs. human outcome)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.action_brain_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  household_id uuid REFERENCES public.households(id) ON DELETE SET NULL,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_role text NOT NULL CHECK (actor_role IN ('CLIENT','ADVISOR','EXTERNAL_PRO','SYSTEM_AGENT')),
  action_type text NOT NULL,
  workflow_module text NOT NULL,
  input_context_snapshot jsonb NOT NULL,
  system_proposed_payload jsonb,
  human_final_payload jsonb NOT NULL,
  delta_score double precision,
  metadata jsonb
);
CREATE INDEX IF NOT EXISTS idx_action_brain_events_household
  ON public.action_brain_events (household_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_action_brain_events_module
  ON public.action_brain_events (workflow_module, action_type, created_at DESC);

GRANT SELECT ON public.action_brain_events TO authenticated;
GRANT ALL ON public.action_brain_events TO service_role;
ALTER TABLE public.action_brain_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff view action brain events" ON public.action_brain_events
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Service manages action brain events" ON public.action_brain_events
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- 6. ai_training_trajectories (PII-scrubbed alignment pairs; no household_id
--    by design -- linkage back to a household goes only via source_event_id)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ai_training_trajectories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  source_event_id uuid REFERENCES public.action_brain_events(id) ON DELETE CASCADE,
  workflow_type text NOT NULL,
  scrubbed_input_prompt text NOT NULL,
  scrubbed_ai_response text NOT NULL,
  scrubbed_human_response text NOT NULL,
  feedback_signal text NOT NULL CHECK (feedback_signal IN ('ACCEPT','MINOR_EDIT','MAJOR_OVERRIDE','REJECT')),
  is_exported_for_training boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_ai_training_trajectories_export
  ON public.ai_training_trajectories (is_exported_for_training, created_at);
CREATE INDEX IF NOT EXISTS idx_ai_training_trajectories_source
  ON public.ai_training_trajectories (source_event_id);

-- service_role only: nothing staff-facing reads this table.
GRANT ALL ON public.ai_training_trajectories TO service_role;
ALTER TABLE public.ai_training_trajectories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service manages ai training trajectories" ON public.ai_training_trajectories
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- 7. pwa_push_subscriptions (Web Push / VAPID; per staff auth user)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.pwa_push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint text NOT NULL UNIQUE,
  p256dh text NOT NULL,
  auth text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pwa_push_subscriptions_user
  ON public.pwa_push_subscriptions (user_id);

GRANT SELECT, INSERT, DELETE ON public.pwa_push_subscriptions TO authenticated;
GRANT ALL ON public.pwa_push_subscriptions TO service_role;
ALTER TABLE public.pwa_push_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own push subscriptions" ON public.pwa_push_subscriptions
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Users add own push subscriptions" ON public.pwa_push_subscriptions
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users remove own push subscriptions" ON public.pwa_push_subscriptions
  FOR DELETE TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Service manages push subscriptions" ON public.pwa_push_subscriptions
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Web Push for the client portal. Clients have no auth.users row (they use
-- portal tokens tied to a contact), so pwa_push_subscriptions -- created in
-- 20261004120000 for staff users -- must also be able to hold a contact's
-- subscription. Only touches objects this branch created; strictly additive
-- except for relaxing user_id to nullable on that new, still-empty table.
ALTER TABLE public.pwa_push_subscriptions ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.pwa_push_subscriptions
  ADD COLUMN IF NOT EXISTS contact_id uuid REFERENCES public.contacts(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS household_id uuid REFERENCES public.households(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS user_agent text,
  ADD COLUMN IF NOT EXISTS failure_count int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_success_at timestamptz;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pwa_push_subscriptions_owner_chk') THEN
    ALTER TABLE public.pwa_push_subscriptions
      ADD CONSTRAINT pwa_push_subscriptions_owner_chk CHECK (user_id IS NOT NULL OR contact_id IS NOT NULL);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_pwa_push_subscriptions_contact ON public.pwa_push_subscriptions (contact_id);
CREATE INDEX IF NOT EXISTS idx_pwa_push_subscriptions_household ON public.pwa_push_subscriptions (household_id);

-- One row per client notification that has been (or is being) pushed. The
-- drain claims a notification by inserting here first (PK = idempotency key),
-- so overlapping cron runs can never double-send.
CREATE TABLE IF NOT EXISTS public.push_deliveries (
  notification_id uuid PRIMARY KEY REFERENCES public.portal_client_notifications(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_count int NOT NULL DEFAULT 0,
  failed_count int NOT NULL DEFAULT 0,
  completed_at timestamptz
);

GRANT ALL ON public.push_deliveries TO service_role;
ALTER TABLE public.push_deliveries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service manages push deliveries" ON public.push_deliveries
  FOR ALL TO service_role USING (true) WITH CHECK (true);
