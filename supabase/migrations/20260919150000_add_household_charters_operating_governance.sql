-- household_charters: Perspective 3 "Operating Governance & Spoke
-- Orchestration" columns.
--
-- governance_snapshot is a computed-once-and-stored JSONB blob (same
-- pattern as treasury_snapshot), populated by the new
-- `recompute_governance_snapshot` action:
--   - vault_protocol_readiness: computeVaultReadiness's existing check,
--     extended to also require the "business" category for corporate-track
--     households (shareholder agreements/minute books matter here).
--   - tax_shields: null for personal-track households (no corporation, no
--     SBD/LCGE exposure -- an honest omission, never a fabricated zero).
--     Corporate-track: sbd_clawback + active_asset_ratio, computed from the
--     two advisor-input numbers below plus the real totalCorpAssets figure
--     gatherHouseholdFinancials already computes.
--
-- corporate_passive_income_annual / active_operational_assets_value reuse
-- the exact field names sovereignty-diagnostics.ts's DiagnosticInputs
-- already established for this same advisor-input concept on the older
-- Stabilization Map -- no schema anywhere tracks a P&L/passive-income split
-- or active-vs-investment asset classification, so these stay manually
-- entered, same as they always have been.
--
-- cda_balance: advisor-input only, no formula exists anywhere in this CRM
-- to derive a Capital Dividend Account balance -- the frontend must present
-- this with an explicit "must be verified by staff" caption.
--
-- The four narrative columns cover what has no formula at all: Hub-and-
-- Spoke Coordination Cadence, the Tri-Party MOU protocol, the Pure
-- Fiduciary Standard, and Section 112 ITA inter-corp dividend monitoring
-- (folded into tax_friction_shields_note as qualitative commentary -- no
-- structured field, since no schema tracks inter-corp dividend flows).
ALTER TABLE public.household_charters
  ADD COLUMN governance_snapshot jsonb,
  ADD COLUMN governance_snapshot_computed_at timestamptz,
  ADD COLUMN corporate_passive_income_annual numeric,
  ADD COLUMN active_operational_assets_value numeric,
  ADD COLUMN cda_balance numeric,
  ADD COLUMN tax_friction_shields_note text,
  ADD COLUMN hub_spoke_cadence_note text,
  ADD COLUMN tri_party_mou_note text,
  ADD COLUMN pure_fiduciary_standard_note text;

-- Review & Complete moves from step 8 (Phase 3's numbering) to step 11 to
-- make room for this phase's 3 new steps. Bump any row already sitting at
-- the old terminal step so `furthest` keeps pointing at the real Review
-- step -- OnboardingStepper.tsx gates purely on step.id <= furthest.
UPDATE public.household_charters SET step = 11 WHERE step = 8;
