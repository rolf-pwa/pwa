-- household_charters: Perspective 4 "Human Capital & Generational
-- Stewardship" columns.
--
-- next_gen_milestones is a staff-maintained JSONB checklist, NOT automated:
-- this CRM has no birthdate/age data for any contact anywhere, so an
-- age-21-triggered "junior observer seat" rule cannot be computed -- staff
-- add/edit rows by hand. No defaults are seeded (unlike core_values /
-- grounding_principles' fixed 4-row framework) because applicability varies
-- entirely per family -- some households have no rising generation at all.
--
-- philanthropic_stewardship_note is AI-draftable, grounded explicitly in the
-- real, already-computed treasury_snapshot.storehouse_reserves.philanthropic
-- figure (Phase 2, shipped) -- draft_perspective_4 pulls that number into
-- its prompt as a stated fact, never re-derives or fabricates it.
--
-- family_values_addendum_signed_at / _reaffirmed_at are plain staff-set
-- completion markers (a "Mark signed/reaffirmed today" button, no upload/
-- e-sign integration) -- the one doc-listed Perspective 4 KPI with a real,
-- honestly trackable schema. Staleness (the doc's 3-year reaffirmation
-- cadence) is computed live via the new computeValuesAddendumStaleness
-- helper, mirroring computeUsaStaleness's >2-year pattern -- never cached.
ALTER TABLE public.household_charters
  ADD COLUMN identity_transition_note text,
  ADD COLUMN next_gen_milestones jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN philanthropic_stewardship_note text,
  ADD COLUMN family_values_addendum_signed_at timestamptz,
  ADD COLUMN family_values_addendum_reaffirmed_at timestamptz;

-- Review & Complete moves from step 11 (Phase 4's numbering) to step 13 to
-- make room for this phase's 2 new steps. Bump any row already sitting at
-- the old terminal step so `furthest` keeps pointing at the real Review
-- step -- OnboardingStepper.tsx gates purely on step.id <= furthest.
UPDATE public.household_charters SET step = 13 WHERE step = 11;
