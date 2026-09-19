-- household_charters: the v2.0 Sovereignty Charter record, household-scoped
-- (a real departure from v1's contact-scoped sovereignty_charters, which
-- stays untouched until a household is individually migrated). Named as
-- the umbrella v2.0 record deliberately -- this first pass only populates
-- the "Foundational Bedrock" columns (vision_text, core_values,
-- grounding_principles), but later phases add the 4 Balanced Scorecard
-- Perspectives (Treasury & Capital, Family Well-Being & Stakeholder
-- Harmony, Operating Governance & Spoke Orchestration, Human Capital &
-- Generational Stewardship) as additional nullable columns on this same
-- table via later ALTER TABLE migrations, not a rename/new table.
--
-- One row per household (UNIQUE(household_id)). `step` mirrors
-- households.onboarding_step's convention: an integer bumped monotonically
-- server-side as staff complete each wizard step. `status` is a separate,
-- deliberate completion flag -- a household can have step=4 (all steps
-- visited) without staff having hit "Mark Complete" yet.
--
-- core_values / grounding_principles are JSONB arrays of
-- {key, title, description} -- ProsperWise supplies the 4 standard
-- title+key rows (seeded server-side by charter-intake's `load` action the
-- first time a household's record is created), families/staff customize
-- the description text per row. Titles are also editable but keys stay
-- stable so future code can address a specific value/principle without
-- depending on title text.
--
-- Flat staff-trust RLS, matching pm_projects/daily_briefings/families --
-- per-user filtering (if ever needed) happens at the query layer, not RLS.

CREATE TABLE public.household_charters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'complete')),
  step integer NOT NULL DEFAULT 1,
  vision_text text,
  core_values jsonb NOT NULL DEFAULT '[]'::jsonb,
  grounding_principles jsonb NOT NULL DEFAULT '[]'::jsonb,
  completed_at timestamptz,
  completed_by uuid,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (household_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.household_charters TO authenticated;
GRANT ALL ON public.household_charters TO service_role;

ALTER TABLE public.household_charters ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can view household charters"
  ON public.household_charters FOR SELECT TO authenticated USING (true);
CREATE POLICY "Staff can create household charters"
  ON public.household_charters FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Staff can update household charters"
  ON public.household_charters FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Staff can delete household charters"
  ON public.household_charters FOR DELETE TO authenticated USING (true);
CREATE POLICY "Service manages household charters"
  ON public.household_charters FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE INDEX idx_household_charters_household ON public.household_charters (household_id);

CREATE TRIGGER update_household_charters_updated_at
  BEFORE UPDATE ON public.household_charters
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
