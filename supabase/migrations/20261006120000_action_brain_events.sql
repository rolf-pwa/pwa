-- Action Brain: one row each time staff accept, edit or reject something the V2 engine
-- proposed (Glass-Box review decisions, Shoebox filing decisions). Strictly additive; written by
-- service-role edge functions only, readable by staff. Nothing reads or exports it yet.
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

ALTER TABLE public.action_brain_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Staff view action brain events" ON public.action_brain_events;
CREATE POLICY "Staff view action brain events" ON public.action_brain_events
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Service manages action brain events" ON public.action_brain_events;
CREATE POLICY "Service manages action brain events" ON public.action_brain_events
  FOR ALL TO service_role USING (true) WITH CHECK (true);
-- Only the service role may write (staff never insert directly).
REVOKE INSERT, UPDATE, DELETE ON public.action_brain_events FROM anon, authenticated;
REVOKE ALL ON public.action_brain_events FROM anon;
GRANT SELECT ON public.action_brain_events TO authenticated;
GRANT ALL ON public.action_brain_events TO service_role;
