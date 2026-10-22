-- Where each household is in the insurance process (New Lead through Coverage Agreed). One row per household; moved_at is when it entered the stage.
CREATE TABLE IF NOT EXISTS public.insurance_pipeline (
  household_id uuid PRIMARY KEY REFERENCES public.households(id) ON DELETE CASCADE,
  stage text NOT NULL DEFAULT 'new_lead' CHECK (stage IN ('new_lead', 'discovery', 'needs_analysis', 'recommendation', 'coverage_agreed')),
  moved_at timestamptz NOT NULL DEFAULT now(),
  moved_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.insurance_pipeline ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.insurance_pipeline TO authenticated;
GRANT ALL ON public.insurance_pipeline TO service_role;
CREATE POLICY "Advisors can view the insurance pipeline" ON public.insurance_pipeline FOR SELECT TO authenticated USING (true);
CREATE POLICY "Advisors can add to the insurance pipeline" ON public.insurance_pipeline FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Advisors can move households in the insurance pipeline" ON public.insurance_pipeline FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Advisors can remove households from the insurance pipeline" ON public.insurance_pipeline FOR DELETE TO authenticated USING (true);
