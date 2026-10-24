-- Investments phase 3a: the contract after the iA application: the application and contract evidence, when the client received the confirmation and the Fund Facts,
-- and the right-to-cancel window (the number of business days is entered from the contract; it is not assumed), with a delivery letter the client confirms.
CREATE TABLE IF NOT EXISTS public.investment_contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  contract_number text,
  accounts text,
  amount numeric,
  application_url text,
  application_name text,
  contract_url text,
  contract_name text,
  issued_on date,
  confirmation_received_on date,
  cancel_business_days int CHECK (cancel_business_days IS NULL OR (cancel_business_days >= 0 AND cancel_business_days <= 60)),
  cancel_ends_on date,
  fund_facts_on date,
  fund_facts_note text,
  letter_document_id uuid REFERENCES public.insurance_documents(id) ON DELETE SET NULL,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_investment_contracts_household ON public.investment_contracts (household_id, created_at DESC);
ALTER TABLE public.investment_contracts ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.investment_contracts TO service_role;
CREATE POLICY "Service manage investment contracts" ON public.investment_contracts FOR ALL TO service_role USING (true) WITH CHECK (true);

-- The delivery letter goes through the signing engine as its own kind (the insurance workspace does not list it).
ALTER TABLE public.insurance_documents DROP CONSTRAINT IF EXISTS insurance_documents_kind_check;
ALTER TABLE public.insurance_documents ADD CONSTRAINT insurance_documents_kind_check CHECK (kind IN ('disclosure_privacy', 'reason_why', 'fact_find', 'replacement_declaration', 'replacement_explanation', 'delivery_letter', 'investment_reason_why', 'investment_delivery_letter'));

-- Seven-year retention: the delete guard counts the contracts too.
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
      'investment_files', 'investment_profiles', 'investment_recommendations', 'investment_reports', 'investment_contracts',
      'intake_classifications', 'investor_profiles', 'onboarding_cases', 'portfolio_review_publications', 'quarterly_system_reviews', 'rental_properties', 'review_obligations',
      'stage2_verification_audit', 'tax_slip_extracts', 'vault_bulk_import_items'];
  ELSIF TG_TABLE_NAME = 'contacts' THEN
    noun := 'person';
    SELECT relationship_ended_at INTO ended FROM public.households WHERE id = OLD.household_id;
    recs := ARRAY['investment_profiles', 'investment_recommendations', 'investment_contracts', 'insurance_policies', 'insurance_fact_finds', 'insurance_issuances', 'insurance_needs_analyses', 'insurance_quotes', 'insurance_document_signers', 'liabilities',
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
