-- Seven-year retention: client records must be kept for 7 years after the advisory relationship ends. This blocks the permanent deletion of a household, a person or a
-- family that holds client records, unless the relationship ended 7 or more years ago. Without it, deleting a household (or its family) cascades through the insurance
-- files, signed documents, fact finds, quotes, accounts and audit trails and removes them. A record that holds no client records at all (a duplicate or a mistake)
-- can still be deleted. The retention-review job already flags households 7 years after the end date; this is the other half. Nothing here deletes anything.
--
-- Break-glass (a court order, a privacy request to destroy, a mistaken import): a database administrator can run, in the same transaction as the delete,
--   select set_config('app.allow_regulated_delete', 'on', true);
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
      'intake_classifications', 'investor_profiles', 'onboarding_cases', 'portfolio_review_publications', 'quarterly_system_reviews', 'rental_properties', 'review_obligations',
      'stage2_verification_audit', 'tax_slip_extracts', 'vault_bulk_import_items'];
  ELSIF TG_TABLE_NAME = 'contacts' THEN
    noun := 'person';
    SELECT relationship_ended_at INTO ended FROM public.households WHERE id = OLD.household_id;
    recs := ARRAY['insurance_policies', 'insurance_fact_finds', 'insurance_issuances', 'insurance_needs_analyses', 'insurance_quotes', 'insurance_document_signers', 'liabilities',
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

DROP TRIGGER IF EXISTS guard_regulated_delete ON public.households;
CREATE TRIGGER guard_regulated_delete BEFORE DELETE ON public.households FOR EACH ROW EXECUTE FUNCTION public.guard_regulated_delete();
DROP TRIGGER IF EXISTS guard_regulated_delete ON public.contacts;
CREATE TRIGGER guard_regulated_delete BEFORE DELETE ON public.contacts FOR EACH ROW EXECUTE FUNCTION public.guard_regulated_delete();
DROP TRIGGER IF EXISTS guard_regulated_delete ON public.families;
CREATE TRIGGER guard_regulated_delete BEFORE DELETE ON public.families FOR EACH ROW EXECUTE FUNCTION public.guard_regulated_delete();
