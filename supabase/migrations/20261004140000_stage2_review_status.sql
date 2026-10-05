-- Review state for held Stage 2 results (V2 vault scan holds extractions in
-- stage2_verification_audit until an advisor approves or rejects them).
-- Strictly additive. Staff still have SELECT only: approve/reject goes
-- through the stage2-review edge function (service role), which is also what
-- applies approved data to live records.
ALTER TABLE public.stage2_verification_audit
  ADD COLUMN IF NOT EXISTS review_status text NOT NULL DEFAULT 'pending'
    CHECK (review_status IN ('pending','approved','rejected')),
  ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS applied_at timestamptz,
  ADD COLUMN IF NOT EXISTS apply_result jsonb;

CREATE INDEX IF NOT EXISTS idx_stage2_verification_audit_review
  ON public.stage2_verification_audit (review_status, created_at DESC);
