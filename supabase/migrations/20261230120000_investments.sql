-- The Investments workspace (segregated funds, iA only): kept apart from Insurance. Where each household is in the process, the compliance file per sale or review
-- (the MGA's checklist), and each person's investor profile and needs analysis with the risk profile recorded from iA's investor profile.

-- Where each household is (same stages as Insurance; the last is "Investment Agreed").
CREATE TABLE IF NOT EXISTS public.investment_pipeline (
  household_id uuid PRIMARY KEY REFERENCES public.households(id) ON DELETE CASCADE,
  stage text NOT NULL DEFAULT 'new_lead' CHECK (stage IN ('new_lead', 'discovery', 'needs_analysis', 'recommendation', 'investment_agreed')),
  moved_at timestamptz NOT NULL DEFAULT now(),
  moved_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.investment_pipeline ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.investment_pipeline TO authenticated;
GRANT ALL ON public.investment_pipeline TO service_role;
CREATE POLICY "Advisors can view the investment pipeline" ON public.investment_pipeline FOR SELECT TO authenticated USING (true);
CREATE POLICY "Advisors can add to the investment pipeline" ON public.investment_pipeline FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Advisors can move households in the investment pipeline" ON public.investment_pipeline FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Advisors can remove households from the investment pipeline" ON public.investment_pipeline FOR DELETE TO authenticated USING (true);

-- One compliance file per sale (or annual review), with its checklist items. Read and written through review-agent-admin, which checks the caller is staff.
CREATE TABLE IF NOT EXISTS public.investment_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  title text NOT NULL,
  kind text NOT NULL DEFAULT 'new_sale' CHECK (kind IN ('new_sale', 'review')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'complete')),
  opened_at timestamptz NOT NULL DEFAULT now(),
  created_by text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_investment_files_household ON public.investment_files (household_id, opened_at DESC);
ALTER TABLE public.investment_files ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.investment_files TO service_role;
CREATE POLICY "Service manage investment files" ON public.investment_files FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.investment_file_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_id uuid NOT NULL REFERENCES public.investment_files(id) ON DELETE CASCADE,
  kind text NOT NULL,
  status text NOT NULL DEFAULT 'provided' CHECK (status IN ('provided', 'not_applicable')),
  drive_file_id text,
  drive_name text,
  drive_url text,
  meeting_task_id uuid,
  note text,
  added_by text,
  added_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_investment_file_items_file ON public.investment_file_items (file_id, added_at);
ALTER TABLE public.investment_file_items ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.investment_file_items TO service_role;
CREATE POLICY "Service manage investment file items" ON public.investment_file_items FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Each person's investor profile and needs analysis, saved as dated versions. risk_profile is the iA model portfolio profile (ia_model_portfolios.profile_key)
-- recorded from the investor profile completed with the iA application.
CREATE TABLE IF NOT EXISTS public.investment_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid REFERENCES public.households(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  inputs jsonb NOT NULL,
  risk_profile text,
  note text,
  pdf_drive_id text,
  pdf_url text,
  filed_at timestamptz,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_investment_profiles_contact ON public.investment_profiles (contact_id, created_at DESC);
ALTER TABLE public.investment_profiles ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON public.investment_profiles TO authenticated;
GRANT ALL ON public.investment_profiles TO service_role;
CREATE POLICY "Advisors can view investment profiles" ON public.investment_profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "Advisors can save investment profiles" ON public.investment_profiles FOR INSERT TO authenticated WITH CHECK (true);

-- Seven-year retention: these are client records, so the delete guard (20261224) now counts them. Same function, two more record tables per list.
CREATE OR REPLACE FUNCTION public.guard_regulated_delete() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  ended timestamptz;
  recs text[];
  kept text[] := '{}';
  r record;
  present boolean;
  noun text;
BEGIN
  IF current_setting('app.allow_regulated_delete', true) = 'on' THEN RETURN OLD; END IF;

  IF TG_TABLE_NAME = 'households' THEN
    noun := 'household';
    ended := OLD.relationship_ended_at;
    recs := ARRAY['cashflow_analyses', 'estate_documents', 'governance_audits', 'guarantee_resets', 'household_charters', 'household_ontology_assessments', 'household_tax_columns',
      'insurance_documents', 'insurance_fact_finds', 'insurance_files', 'insurance_issuances', 'insurance_needs_analyses', 'insurance_quotes', 'insurance_replacements',
      'investment_files', 'investment_profiles',
      'intake_classifications', 'investor_profiles', 'onboarding_cases', 'portfolio_review_publications', 'quarterly_system_reviews', 'rental_properties', 'review_obligations',
      'stage2_verification_audit', 'tax_slip_extracts', 'vault_bulk_import_items'];
  ELSIF TG_TABLE_NAME = 'contacts' THEN
    noun := 'person';
    SELECT relationship_ended_at INTO ended FROM public.households WHERE id = OLD.household_id;
    recs := ARRAY['investment_profiles', 'insurance_policies', 'insurance_fact_finds', 'insurance_issuances', 'insurance_needs_analyses', 'insurance_quotes', 'insurance_document_signers', 'liabilities',
      'storehouses', 'vineyard_accounts', 'holding_tank', 'account_harvest_snapshots', 'rebalance_acknowledgements', 'sovereignty_charters', 'sovereignty_audit_trail',
      'sovereignty_charter_sources', 'shareholders', 'rental_property_owners', 'household_tax_columns', 'veem_payer_details'];
  ELSIF TG_TABLE_NAME = 'families' THEN
    noun := 'family';
    -- A family may go once every household in it ended 7 or more years ago (or it has none).
    IF NOT EXISTS (SELECT 1 FROM public.households h WHERE h.family_id = OLD.id AND (h.relationship_ended_at IS NULL OR h.relationship_ended_at > now() - interval '7 years')) THEN
      ended := '-infinity';
    END IF;
    recs := ARRAY['rebalance_acknowledgements', 'review_obligations', 'storehouse_rules', 'waterfall_priorities'];
  ELSE
    RETURN OLD;
  END IF;

  IF ended IS NOT NULL AND ended <= now() - interval '7 years' THEN RETURN OLD; END IF;

  -- Which of the record tables that would be deleted along with it have rows for it.
  FOR r IN
    SELECT cl.relname AS tbl, a.attname AS col
    FROM pg_constraint c
    JOIN pg_class cl ON cl.oid = c.conrelid
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
    WHERE c.contype = 'f' AND c.confdeltype = 'c' AND c.confrelid = TG_RELID AND array_length(c.conkey, 1) = 1 AND cl.relname = ANY (recs)
    ORDER BY cl.relname
  LOOP
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM public.%I WHERE %I = $1)', r.tbl, r.col) INTO present USING OLD.id;
    IF present THEN kept := kept || replace(r.tbl, '_', ' '); END IF;
  END LOOP;

  IF array_length(kept, 1) IS NULL THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'This % cannot be permanently deleted: it holds client records that must be kept for 7 years after the advisory relationship ends (%).', noun, array_to_string(kept, ', ')
    USING ERRCODE = 'P0001', HINT = 'End the relationship instead: the record moves to Former clients and stays available to staff until the 7 years are over.';
END;
$$;
