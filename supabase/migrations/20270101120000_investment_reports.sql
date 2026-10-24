-- Investment Recommendation Reports filed for a household (Advisor Files / Reports), and shared with the people they were prepared for in their portal.
CREATE TABLE IF NOT EXISTS public.investment_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  title text NOT NULL,
  contact_ids uuid[] NOT NULL DEFAULT '{}',
  include_funds boolean NOT NULL DEFAULT true,
  cover_note text,
  pdf_drive_id text NOT NULL,
  pdf_url text NOT NULL,
  pdf_name text NOT NULL,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  shared_at timestamptz,
  shared_by text
);
CREATE INDEX IF NOT EXISTS idx_investment_reports_household ON public.investment_reports (household_id, created_at DESC);
ALTER TABLE public.investment_reports ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.investment_reports TO service_role;
CREATE POLICY "Service manage investment reports" ON public.investment_reports FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Seven-year retention: the delete guard counts the reports too.
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
      'investment_files', 'investment_profiles', 'investment_recommendations', 'investment_reports',
      'intake_classifications', 'investor_profiles', 'onboarding_cases', 'portfolio_review_publications', 'quarterly_system_reviews', 'rental_properties', 'review_obligations',
      'stage2_verification_audit', 'tax_slip_extracts', 'vault_bulk_import_items'];
  ELSIF TG_TABLE_NAME = 'contacts' THEN
    noun := 'person';
    SELECT relationship_ended_at INTO ended FROM public.households WHERE id = OLD.household_id;
    recs := ARRAY['investment_profiles', 'investment_recommendations', 'insurance_policies', 'insurance_fact_finds', 'insurance_issuances', 'insurance_needs_analyses', 'insurance_quotes', 'insurance_document_signers', 'liabilities',
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
