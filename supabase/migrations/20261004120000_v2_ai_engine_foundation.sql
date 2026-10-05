-- V2 AI Engine foundation, desktop release (release/v2-desktop): feature flag, health logs,
-- Stage 2 verification audit, advisor overrides. (Action Brain, training and Web Push tables
-- live in the held-back mobile/training branch.)
-- Strictly additive: IF NOT EXISTS everywhere, no drops/renames/type changes.
--
-- RLS model (matches the repo's existing "flat staff trust" convention, e.g.
-- household_charters / household_ontology_assessments): `authenticated` is
-- staff only; clients never hold a Supabase JWT and reach their data through
-- service-role edge functions (portal-auth). So there is no client-facing
-- household-membership policy to write -- every row is household_id-keyed and
-- indexed, anon gets nothing, and service_role does the writes. If clients
-- ever get real auth.users sessions, add a household-membership policy then.
--
-- Tables whose rows are written by AI/edge agents (health logs, audit)
-- are read-only to staff; only service_role writes them.

-- ---------------------------------------------------------------------------
-- 1. Household feature flag (gates every V2 path; default OFF = V1 behaviour)
-- ---------------------------------------------------------------------------
ALTER TABLE public.households
  ADD COLUMN IF NOT EXISTS v2_ai_engine_enabled boolean NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------------
-- 2. system_health_logs (Sentinel SRE agent)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.system_health_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  function_name text NOT NULL,
  execution_id text,
  household_id uuid REFERENCES public.households(id) ON DELETE SET NULL,
  severity text NOT NULL CHECK (severity IN ('INFO','WARN','ERROR','FATAL')),
  error_code text,
  error_message text,
  stack_trace text,
  input_payload jsonb,  -- callers must PII-scrub before writing
  retry_count int NOT NULL DEFAULT 0,
  max_retries int NOT NULL DEFAULT 3,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','RETRIED','RESOLVED','ESCALATED'))
);
CREATE INDEX IF NOT EXISTS idx_system_health_logs_status_created
  ON public.system_health_logs (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_system_health_logs_household
  ON public.system_health_logs (household_id, created_at DESC);

GRANT SELECT ON public.system_health_logs TO authenticated;
GRANT ALL ON public.system_health_logs TO service_role;
ALTER TABLE public.system_health_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff view system health logs" ON public.system_health_logs
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Service manages system health logs" ON public.system_health_logs
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- 3. stage2_verification_audit (Stage 2 verification + causal DAG results)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.stage2_verification_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  document_id uuid REFERENCES public.vault_shoebox_proposals(id) ON DELETE CASCADE,
  overall_status text NOT NULL CHECK (overall_status IN ('VERIFIED','INCOMPLETE','CONFLICT')),
  extracted_entities jsonb NOT NULL,      -- values + page_number / bounding_box provenance
  arithmetic_checks jsonb NOT NULL,       -- pass/fail + plain-English reasoning chains
  causal_dag_evaluations jsonb NOT NULL,  -- shape owned by _shared/causal-dag-evaluator.ts
  missing_items jsonb,
  advisor_override_required boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_stage2_verification_audit_household
  ON public.stage2_verification_audit (household_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stage2_verification_audit_document
  ON public.stage2_verification_audit (document_id);

GRANT SELECT ON public.stage2_verification_audit TO authenticated;
GRANT ALL ON public.stage2_verification_audit TO service_role;
ALTER TABLE public.stage2_verification_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff view stage2 verification audit" ON public.stage2_verification_audit
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Service manages stage2 verification audit" ON public.stage2_verification_audit
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- 4. golden_dataset_overrides (advisor corrections of AI-extracted values)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.golden_dataset_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  advisor_id uuid NOT NULL REFERENCES auth.users(id),
  document_id uuid REFERENCES public.vault_shoebox_proposals(id) ON DELETE SET NULL,
  field_name text NOT NULL,
  original_ai_value jsonb NOT NULL,
  corrected_value jsonb NOT NULL,
  reasoning_notes text
);
CREATE INDEX IF NOT EXISTS idx_golden_dataset_overrides_household
  ON public.golden_dataset_overrides (household_id, created_at DESC);

GRANT SELECT, INSERT ON public.golden_dataset_overrides TO authenticated;
GRANT ALL ON public.golden_dataset_overrides TO service_role;
ALTER TABLE public.golden_dataset_overrides ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff view golden dataset overrides" ON public.golden_dataset_overrides
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Advisors record own golden dataset overrides" ON public.golden_dataset_overrides
  FOR INSERT TO authenticated WITH CHECK (advisor_id = auth.uid());
CREATE POLICY "Service manages golden dataset overrides" ON public.golden_dataset_overrides
  FOR ALL TO service_role USING (true) WITH CHECK (true);
