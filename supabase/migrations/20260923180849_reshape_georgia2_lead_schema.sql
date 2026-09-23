-- Causal AI Platform, Phase 0 ("Ask Georgia"): persist what the funnel
-- already computes client-side but never saves, so a stable, queryable
-- self-reported baseline exists for Phase 2's Delta Engine to reconcile
-- against later. jurisdiction defaults to British Columbia because every
-- catalyst's copy/questions in derive.ts already assume BC exclusively
-- (BC Probate, BC Family Law Act, BC-specific LCGE framing) -- this simply
-- makes that existing assumption an explicit, queryable fact instead of an
-- implicit one.
--
-- risk_scores_calculated mirrors the blueprint's own nested shape exactly
-- ({tax_drag_risk, structure_safety, noise_strain, readiness_score}) so a
-- later consumer (Phase 2) can read it without reshaping -- computed today
-- by computeGauges() in src/modules/intake/lib/derive.ts (frontend) and
-- mirrored server-side in georgia2-lead/index.ts (Deno can't import from
-- src/, matching this codebase's established per-function-duplication
-- convention, e.g. SERVICE_TIER_CADENCE_TEXT).
--
-- primary_noise_exposure is a bucketed label derived server-side from the
-- already-computed noise_strain gauge (Low/Moderate/High/Critical), not a
-- new user-facing input.
--
-- unstructured_stress_quote stays nullable and unpopulated for now -- no
-- free-text field exists anywhere in the current Georgia 2.0 UI to capture
-- one. Left genuinely empty rather than fabricated; a future pass can wire
-- up a real "tell us more" field if wanted.
ALTER TABLE public.georgia2_leads
  ADD COLUMN jurisdiction text NOT NULL DEFAULT 'British Columbia',
  ADD COLUMN primary_noise_exposure text,
  ADD COLUMN unstructured_stress_quote text,
  ADD COLUMN risk_scores_calculated jsonb;

-- Same fields mirrored onto georgia2_sessions -- georgia2-lead's own upsert
-- into this table already mirrors domain/catalyst/scale/answers on lead
-- capture, so keeping these in lockstep avoids the two tables drifting.
ALTER TABLE public.georgia2_sessions
  ADD COLUMN risk_scores_calculated jsonb;
