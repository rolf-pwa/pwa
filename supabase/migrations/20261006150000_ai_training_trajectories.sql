-- De-identified training pairs, built from action_brain_events by the training-export function
-- (kill-switched, off by default). No household_id by design: the only link back is
-- source_event_id. Service-role only; no staff or anonymous access of any kind. Strictly additive.
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
-- One pair per source event so rebuilding is idempotent. Deliberately not a partial index:
-- PostgREST upsert issues a plain ON CONFLICT (source_event_id).
CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_training_trajectories_source_event
  ON public.ai_training_trajectories (source_event_id);

ALTER TABLE public.ai_training_trajectories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service manages ai training trajectories" ON public.ai_training_trajectories;
CREATE POLICY "Service manages ai training trajectories" ON public.ai_training_trajectories
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.ai_training_trajectories FROM anon, authenticated;
GRANT ALL ON public.ai_training_trajectories TO service_role;
