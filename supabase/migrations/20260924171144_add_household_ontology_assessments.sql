-- Causal AI Platform, Phase 1: the Hub & Spoke Ontology (architectural
-- blueprint §4). One row per assessment, not a household column -- the
-- Hub is meant to be reassessed over time (a future Longitudinal Tracking
-- Engine just queries multiple rows for the same household), matching the
-- existing JSONB-snapshot-per-row convention already used for
-- household_charters.treasury_snapshot / stabilization_maps.diagnostics.
--
-- financial_state / relational_state / emotional_state (the Hub) and
-- event_spoke_data (the catalyst-specific Spoke, shape depends on
-- event_spoke_type) are stored as JSONB rather than normalized into ~25
-- individual columns -- each field is optional and staff-entered, so a
-- flexible blob avoids a brittle wide-table migration for a schema still
-- expected to evolve. Field shapes are defined in TypeScript in
-- supabase/functions/_shared/causal-dag-evaluator.ts (the single source of
-- truth for what's inside these blobs) and mirrored in
-- src/modules/audit/components/ontology/StepOntologyAssessment.tsx.
--
-- event_spoke_type stays plain TEXT (not a Postgres enum), matching this
-- codebase's established preference for evolving concepts (see
-- georgia2_leads.domain/catalyst) -- validated in code, not the DB.
--
-- source_georgia2_lead_id / seeded_from: when a lead converts (pays for
-- the Sovereignty Survey), enrollPaidBooking() seeds one row here from
-- that lead's diagnostic answers -- seeded_from is a read-only snapshot of
-- what Georgia 2.0 actually collected, kept for provenance/reference, not
-- treated as authoritative Hub/Spoke data itself (see the seeding step's
-- own comments in _shared/booking-enrollment.ts for what does and does not
-- get mapped).
--
-- Flat staff-trust RLS, matching household_charters/pm_projects/families.
CREATE TABLE public.household_ontology_assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  assessment_date date NOT NULL DEFAULT current_date,
  financial_state jsonb,
  relational_state jsonb,
  emotional_state jsonb,
  event_spoke_type text,
  event_spoke_data jsonb,
  source_georgia2_lead_id uuid REFERENCES public.georgia2_leads(id) ON DELETE SET NULL,
  seeded_from jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.household_ontology_assessments TO authenticated;
GRANT ALL ON public.household_ontology_assessments TO service_role;

ALTER TABLE public.household_ontology_assessments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can view household ontology assessments"
  ON public.household_ontology_assessments FOR SELECT TO authenticated USING (true);
CREATE POLICY "Staff can create household ontology assessments"
  ON public.household_ontology_assessments FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Staff can update household ontology assessments"
  ON public.household_ontology_assessments FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Staff can delete household ontology assessments"
  ON public.household_ontology_assessments FOR DELETE TO authenticated USING (true);
CREATE POLICY "Service manages household ontology assessments"
  ON public.household_ontology_assessments FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE INDEX idx_household_ontology_assessments_household
  ON public.household_ontology_assessments (household_id, assessment_date DESC);
CREATE INDEX idx_household_ontology_assessments_lead
  ON public.household_ontology_assessments (source_georgia2_lead_id);

CREATE TRIGGER update_household_ontology_assessments_updated_at
  BEFORE UPDATE ON public.household_ontology_assessments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
