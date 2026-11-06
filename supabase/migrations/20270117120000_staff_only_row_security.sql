-- Staff-only row security. Until now about 240 policies let ANY signed-in database user, and (on liabilities) any anonymous caller, read or change nearly every table:
-- the staff test lived only in the browser. This adds one staff check, the firm's email domain in the signed-in user's token (the same test the newer tables
-- already use), and puts it on every policy that was open. Left open on purpose: the three public forms that only INSERT (ToE acceptance, discovery lead,
-- service booking). Edge functions use the service role, which bypasses row security, so they are not affected.

CREATE OR REPLACE FUNCTION public.is_staff() RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT lower(coalesce(auth.jwt() ->> 'email', '')) LIKE '%@prosperwise.ca'
$$;
GRANT EXECUTE ON FUNCTION public.is_staff() TO anon, authenticated, service_role;

DROP POLICY IF EXISTS "Staff can delete harvest snapshots" ON public.account_harvest_snapshots;
CREATE POLICY "Staff can delete harvest snapshots" ON public.account_harvest_snapshots AS PERMISSIVE FOR DELETE TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Staff can update harvest snapshots" ON public.account_harvest_snapshots;
CREATE POLICY "Staff can update harvest snapshots" ON public.account_harvest_snapshots AS PERMISSIVE FOR UPDATE TO authenticated USING (public.is_staff()) WITH CHECK (((created_by IS NULL) OR (auth.uid() = created_by)));

DROP POLICY IF EXISTS "Staff can view harvest snapshots" ON public.account_harvest_snapshots;
CREATE POLICY "Staff can view harvest snapshots" ON public.account_harvest_snapshots AS PERMISSIVE FOR SELECT TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Staff view action brain events" ON public.action_brain_events;
CREATE POLICY "Staff view action brain events" ON public.action_brain_events AS PERMISSIVE FOR SELECT TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Staff can manage Web Forms" ON public.adobe_webforms;
CREATE POLICY "Staff can manage Web Forms" ON public.adobe_webforms AS PERMISSIVE FOR ALL TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS "Authenticated can read asana sync events" ON public.asana_sync_events;
CREATE POLICY "Authenticated can read asana sync events" ON public.asana_sync_events AS PERMISSIVE FOR SELECT TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Authenticated can read asana sync state" ON public.asana_sync_state;
CREATE POLICY "Authenticated can read asana sync state" ON public.asana_sync_state AS PERMISSIVE FOR SELECT TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Advisors can delete pipeline" ON public.business_pipeline;
CREATE POLICY "Advisors can delete pipeline" ON public.business_pipeline AS PERMISSIVE FOR DELETE TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Advisors can update pipeline" ON public.business_pipeline;
CREATE POLICY "Advisors can update pipeline" ON public.business_pipeline AS PERMISSIVE FOR UPDATE TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Advisors can view pipeline" ON public.business_pipeline;
CREATE POLICY "Advisors can view pipeline" ON public.business_pipeline AS PERMISSIVE FOR SELECT TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Advisors can delete cashflow analyses" ON public.cashflow_analyses;
CREATE POLICY "Advisors can delete cashflow analyses" ON public.cashflow_analyses AS PERMISSIVE FOR DELETE TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Advisors can update cashflow analyses" ON public.cashflow_analyses;
CREATE POLICY "Advisors can update cashflow analyses" ON public.cashflow_analyses AS PERMISSIVE FOR UPDATE TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Advisors can view cashflow analyses" ON public.cashflow_analyses;
CREATE POLICY "Advisors can view cashflow analyses" ON public.cashflow_analyses AS PERMISSIVE FOR SELECT TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Staff can manage contact_email_links" ON public.contact_email_links;
CREATE POLICY "Staff can manage contact_email_links" ON public.contact_email_links AS PERMISSIVE FOR ALL TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS "Staff can manage contact_emails" ON public.contact_emails;
CREATE POLICY "Staff can manage contact_emails" ON public.contact_emails AS PERMISSIVE FOR ALL TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS "Advisors can delete contacts" ON public.contacts;
CREATE POLICY "Advisors can delete contacts" ON public.contacts AS PERMISSIVE FOR DELETE TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Advisors can update all contacts" ON public.contacts;
CREATE POLICY "Advisors can update all contacts" ON public.contacts AS PERMISSIVE FOR UPDATE TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Advisors can view all contacts" ON public.contacts;
CREATE POLICY "Advisors can view all contacts" ON public.contacts AS PERMISSIVE FOR SELECT TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Advisors can delete platform versions" ON public.content_platform_versions;
CREATE POLICY "Advisors can delete platform versions" ON public.content_platform_versions AS PERMISSIVE FOR DELETE TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Advisors can insert platform versions" ON public.content_platform_versions;
CREATE POLICY "Advisors can insert platform versions" ON public.content_platform_versions AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS "Advisors can update platform versions" ON public.content_platform_versions;
CREATE POLICY "Advisors can update platform versions" ON public.content_platform_versions AS PERMISSIVE FOR UPDATE TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Advisors can view platform versions" ON public.content_platform_versions;
CREATE POLICY "Advisors can view platform versions" ON public.content_platform_versions AS PERMISSIVE FOR SELECT TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Advisors can delete content posts" ON public.content_posts;
CREATE POLICY "Advisors can delete content posts" ON public.content_posts AS PERMISSIVE FOR DELETE TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Advisors can update content posts" ON public.content_posts;
CREATE POLICY "Advisors can update content posts" ON public.content_posts AS PERMISSIVE FOR UPDATE TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Advisors can view content posts" ON public.content_posts;
CREATE POLICY "Advisors can view content posts" ON public.content_posts AS PERMISSIVE FOR SELECT TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Staff can delete corporate shareholders" ON public.corporate_shareholders;
CREATE POLICY "Staff can delete corporate shareholders" ON public.corporate_shareholders AS PERMISSIVE FOR DELETE TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Staff can insert corporate shareholders" ON public.corporate_shareholders;
CREATE POLICY "Staff can insert corporate shareholders" ON public.corporate_shareholders AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS "Staff can update corporate shareholders" ON public.corporate_shareholders;
CREATE POLICY "Staff can update corporate shareholders" ON public.corporate_shareholders AS PERMISSIVE FOR UPDATE TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Staff can view corporate shareholders" ON public.corporate_shareholders;
CREATE POLICY "Staff can view corporate shareholders" ON public.corporate_shareholders AS PERMISSIVE FOR SELECT TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Staff can delete corporate vineyard accounts" ON public.corporate_vineyard_accounts;
CREATE POLICY "Staff can delete corporate vineyard accounts" ON public.corporate_vineyard_accounts AS PERMISSIVE FOR DELETE TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Staff can insert corporate vineyard accounts" ON public.corporate_vineyard_accounts;
CREATE POLICY "Staff can insert corporate vineyard accounts" ON public.corporate_vineyard_accounts AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS "Staff can update corporate vineyard accounts" ON public.corporate_vineyard_accounts;
CREATE POLICY "Staff can update corporate vineyard accounts" ON public.corporate_vineyard_accounts AS PERMISSIVE FOR UPDATE TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Staff can view corporate vineyard accounts" ON public.corporate_vineyard_accounts;
CREATE POLICY "Staff can view corporate vineyard accounts" ON public.corporate_vineyard_accounts AS PERMISSIVE FOR SELECT TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Staff can delete corporations" ON public.corporations;
CREATE POLICY "Staff can delete corporations" ON public.corporations AS PERMISSIVE FOR DELETE TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Staff can update corporations" ON public.corporations;
CREATE POLICY "Staff can update corporations" ON public.corporations AS PERMISSIVE FOR UPDATE TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Staff can view corporations" ON public.corporations;
CREATE POLICY "Staff can view corporations" ON public.corporations AS PERMISSIVE FOR SELECT TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Authenticated staff can view intake pushes" ON public.crm_intake_pushes;
CREATE POLICY "Authenticated staff can view intake pushes" ON public.crm_intake_pushes AS PERMISSIVE FOR SELECT TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Staff can delete daily briefings" ON public.daily_briefings;
CREATE POLICY "Staff can delete daily briefings" ON public.daily_briefings AS PERMISSIVE FOR DELETE TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Staff can insert daily briefings" ON public.daily_briefings;
CREATE POLICY "Staff can insert daily briefings" ON public.daily_briefings AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS "Staff can update daily briefings" ON public.daily_briefings;
CREATE POLICY "Staff can update daily briefings" ON public.daily_briefings AS PERMISSIVE FOR UPDATE TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS "Staff can view daily briefings" ON public.daily_briefings;
CREATE POLICY "Staff can view daily briefings" ON public.daily_briefings AS PERMISSIVE FOR SELECT TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Authenticated users can view all recaps" ON public.daily_recaps;
CREATE POLICY "Authenticated users can view all recaps" ON public.daily_recaps AS PERMISSIVE FOR SELECT TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Advisors can update discovery leads" ON public.discovery_leads;
CREATE POLICY "Advisors can update discovery leads" ON public.discovery_leads AS PERMISSIVE FOR UPDATE TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Advisors can view discovery leads" ON public.discovery_leads;
CREATE POLICY "Advisors can view discovery leads" ON public.discovery_leads AS PERMISSIVE FOR SELECT TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Staff can view drive watch state" ON public.drive_watch_state;
CREATE POLICY "Staff can view drive watch state" ON public.drive_watch_state AS PERMISSIVE FOR SELECT TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Staff can manage engagement messages" ON public.engagement_messages;
CREATE POLICY "Staff can manage engagement messages" ON public.engagement_messages AS PERMISSIVE FOR ALL TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS "Staff view estate documents" ON public.estate_documents;
CREATE POLICY "Staff view estate documents" ON public.estate_documents AS PERMISSIVE FOR SELECT TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Staff can delete families" ON public.families;
CREATE POLICY "Staff can delete families" ON public.families AS PERMISSIVE FOR DELETE TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Staff can update families" ON public.families;
CREATE POLICY "Staff can update families" ON public.families AS PERMISSIVE FOR UPDATE TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Staff can view families" ON public.families;
CREATE POLICY "Staff can view families" ON public.families AS PERMISSIVE FOR SELECT TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Staff can delete family relationships" ON public.family_relationships;
CREATE POLICY "Staff can delete family relationships" ON public.family_relationships AS PERMISSIVE FOR DELETE TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Staff can insert family relationships" ON public.family_relationships;
CREATE POLICY "Staff can insert family relationships" ON public.family_relationships AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS "Staff can update family relationships" ON public.family_relationships;
CREATE POLICY "Staff can update family relationships" ON public.family_relationships AS PERMISSIVE FOR UPDATE TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Staff can view family relationships" ON public.family_relationships;
CREATE POLICY "Staff can view family relationships" ON public.family_relationships AS PERMISSIVE FOR SELECT TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Staff can update georgia2 leads" ON public.georgia2_leads;
CREATE POLICY "Staff can update georgia2 leads" ON public.georgia2_leads AS PERMISSIVE FOR UPDATE TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS "Staff can view all georgia2 leads" ON public.georgia2_leads;
CREATE POLICY "Staff can view all georgia2 leads" ON public.georgia2_leads AS PERMISSIVE FOR SELECT TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Staff can view all georgia2 sessions" ON public.georgia2_sessions;
CREATE POLICY "Staff can view all georgia2 sessions" ON public.georgia2_sessions AS PERMISSIVE FOR SELECT TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Staff can update Georgia analytics sync config" ON public.georgia_analytics_sync_configs;
CREATE POLICY "Staff can update Georgia analytics sync config" ON public.georgia_analytics_sync_configs AS PERMISSIVE FOR UPDATE TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS "Staff can view Georgia analytics sync config" ON public.georgia_analytics_sync_configs;
CREATE POLICY "Staff can view Georgia analytics sync config" ON public.georgia_analytics_sync_configs AS PERMISSIVE FOR SELECT TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Staff can view Georgia session starts" ON public.georgia_session_starts;
CREATE POLICY "Staff can view Georgia session starts" ON public.georgia_session_starts AS PERMISSIVE FOR SELECT TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Staff view golden dataset overrides" ON public.golden_dataset_overrides;
CREATE POLICY "Staff view golden dataset overrides" ON public.golden_dataset_overrides AS PERMISSIVE FOR SELECT TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Staff manage governance alignment results" ON public.governance_alignment_results;
CREATE POLICY "Staff manage governance alignment results" ON public.governance_alignment_results AS PERMISSIVE FOR ALL TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS "Staff can delete governance audits" ON public.governance_audits;
CREATE POLICY "Staff can delete governance audits" ON public.governance_audits AS PERMISSIVE FOR DELETE TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Staff can update governance audits" ON public.governance_audits;
CREATE POLICY "Staff can update governance audits" ON public.governance_audits AS PERMISSIVE FOR UPDATE TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS "Staff can view governance audits" ON public.governance_audits;
CREATE POLICY "Staff can view governance audits" ON public.governance_audits AS PERMISSIVE FOR SELECT TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Staff manage governance findings" ON public.governance_review_findings;
CREATE POLICY "Staff manage governance findings" ON public.governance_review_findings AS PERMISSIVE FOR ALL TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS "Advisors can delete holding tank" ON public.holding_tank;
CREATE POLICY "Advisors can delete holding tank" ON public.holding_tank AS PERMISSIVE FOR DELETE TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Advisors can insert holding tank" ON public.holding_tank;
CREATE POLICY "Advisors can insert holding tank" ON public.holding_tank AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS "Advisors can update holding tank" ON public.holding_tank;
CREATE POLICY "Advisors can update holding tank" ON public.holding_tank AS PERMISSIVE FOR UPDATE TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Advisors can view holding tank" ON public.holding_tank;
CREATE POLICY "Advisors can view holding tank" ON public.holding_tank AS PERMISSIVE FOR SELECT TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Staff can create household charters" ON public.household_charters;
CREATE POLICY "Staff can create household charters" ON public.household_charters AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS "Staff can delete household charters" ON public.household_charters;
CREATE POLICY "Staff can delete household charters" ON public.household_charters AS PERMISSIVE FOR DELETE TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Staff can update household charters" ON public.household_charters;
CREATE POLICY "Staff can update household charters" ON public.household_charters AS PERMISSIVE FOR UPDATE TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS "Staff can view household charters" ON public.household_charters;
CREATE POLICY "Staff can view household charters" ON public.household_charters AS PERMISSIVE FOR SELECT TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Staff can create household ontology assessments" ON public.household_ontology_assessments;
CREATE POLICY "Staff can create household ontology assessments" ON public.household_ontology_assessments AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS "Staff can delete household ontology assessments" ON public.household_ontology_assessments;
CREATE POLICY "Staff can delete household ontology assessments" ON public.household_ontology_assessments AS PERMISSIVE FOR DELETE TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Staff can update household ontology assessments" ON public.household_ontology_assessments;
CREATE POLICY "Staff can update household ontology assessments" ON public.household_ontology_assessments AS PERMISSIVE FOR UPDATE TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS "Staff can view household ontology assessments" ON public.household_ontology_assessments;
CREATE POLICY "Staff can view household ontology assessments" ON public.household_ontology_assessments AS PERMISSIVE FOR SELECT TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Staff can delete household relationships" ON public.household_relationships;
CREATE POLICY "Staff can delete household relationships" ON public.household_relationships AS PERMISSIVE FOR DELETE TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Staff can insert household relationships" ON public.household_relationships;
CREATE POLICY "Staff can insert household relationships" ON public.household_relationships AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS "Staff can update household relationships" ON public.household_relationships;
CREATE POLICY "Staff can update household relationships" ON public.household_relationships AS PERMISSIVE FOR UPDATE TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Staff can view household relationships" ON public.household_relationships;
CREATE POLICY "Staff can view household relationships" ON public.household_relationships AS PERMISSIVE FOR SELECT TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Staff can delete households" ON public.households;
CREATE POLICY "Staff can delete households" ON public.households AS PERMISSIVE FOR DELETE TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Staff can insert households" ON public.households;
CREATE POLICY "Staff can insert households" ON public.households AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS "Staff can update households" ON public.households;
CREATE POLICY "Staff can update households" ON public.households AS PERMISSIVE FOR UPDATE TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Staff can view households" ON public.households;
CREATE POLICY "Staff can view households" ON public.households AS PERMISSIVE FOR SELECT TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Advisors can view document templates" ON public.insurance_doc_templates;
CREATE POLICY "Advisors can view document templates" ON public.insurance_doc_templates AS PERMISSIVE FOR SELECT TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Advisors can delete needs analyses" ON public.insurance_needs_analyses;
CREATE POLICY "Advisors can delete needs analyses" ON public.insurance_needs_analyses AS PERMISSIVE FOR DELETE TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Advisors can save needs analyses" ON public.insurance_needs_analyses;
CREATE POLICY "Advisors can save needs analyses" ON public.insurance_needs_analyses AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS "Advisors can view needs analyses" ON public.insurance_needs_analyses;
CREATE POLICY "Advisors can view needs analyses" ON public.insurance_needs_analyses AS PERMISSIVE FOR SELECT TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Advisors can add to the insurance pipeline" ON public.insurance_pipeline;
CREATE POLICY "Advisors can add to the insurance pipeline" ON public.insurance_pipeline AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS "Advisors can move households in the insurance pipeline" ON public.insurance_pipeline;
CREATE POLICY "Advisors can move households in the insurance pipeline" ON public.insurance_pipeline AS PERMISSIVE FOR UPDATE TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS "Advisors can remove households from the insurance pipeline" ON public.insurance_pipeline;
CREATE POLICY "Advisors can remove households from the insurance pipeline" ON public.insurance_pipeline AS PERMISSIVE FOR DELETE TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Advisors can view the insurance pipeline" ON public.insurance_pipeline;
CREATE POLICY "Advisors can view the insurance pipeline" ON public.insurance_pipeline AS PERMISSIVE FOR SELECT TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Advisors can delete insurance policies" ON public.insurance_policies;
CREATE POLICY "Advisors can delete insurance policies" ON public.insurance_policies AS PERMISSIVE FOR DELETE TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Advisors can insert insurance policies" ON public.insurance_policies;
CREATE POLICY "Advisors can insert insurance policies" ON public.insurance_policies AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS "Advisors can update insurance policies" ON public.insurance_policies;
CREATE POLICY "Advisors can update insurance policies" ON public.insurance_policies AS PERMISSIVE FOR UPDATE TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Advisors can view all insurance policies" ON public.insurance_policies;
CREATE POLICY "Advisors can view all insurance policies" ON public.insurance_policies AS PERMISSIVE FOR SELECT TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Advisors can add insurance quotes" ON public.insurance_quotes;
CREATE POLICY "Advisors can add insurance quotes" ON public.insurance_quotes AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS "Advisors can change insurance quotes" ON public.insurance_quotes;
CREATE POLICY "Advisors can change insurance quotes" ON public.insurance_quotes AS PERMISSIVE FOR UPDATE TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS "Advisors can delete insurance quotes" ON public.insurance_quotes;
CREATE POLICY "Advisors can delete insurance quotes" ON public.insurance_quotes AS PERMISSIVE FOR DELETE TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Advisors can view insurance quotes" ON public.insurance_quotes;
CREATE POLICY "Advisors can view insurance quotes" ON public.insurance_quotes AS PERMISSIVE FOR SELECT TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Advisors can view insurance reports" ON public.insurance_reports;
CREATE POLICY "Advisors can view insurance reports" ON public.insurance_reports AS PERMISSIVE FOR SELECT TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Authenticated staff can manage intake checklist templates" ON public.intake_checklist_templates;
CREATE POLICY "Authenticated staff can manage intake checklist templates" ON public.intake_checklist_templates AS PERMISSIVE FOR ALL TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS "Authenticated staff can manage intake classifications" ON public.intake_classifications;
CREATE POLICY "Authenticated staff can manage intake classifications" ON public.intake_classifications AS PERMISSIVE FOR ALL TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS "Advisors can add to the investment pipeline" ON public.investment_pipeline;
CREATE POLICY "Advisors can add to the investment pipeline" ON public.investment_pipeline AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS "Advisors can move households in the investment pipeline" ON public.investment_pipeline;
CREATE POLICY "Advisors can move households in the investment pipeline" ON public.investment_pipeline AS PERMISSIVE FOR UPDATE TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS "Advisors can remove households from the investment pipeline" ON public.investment_pipeline;
CREATE POLICY "Advisors can remove households from the investment pipeline" ON public.investment_pipeline AS PERMISSIVE FOR DELETE TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Advisors can view the investment pipeline" ON public.investment_pipeline;
CREATE POLICY "Advisors can view the investment pipeline" ON public.investment_pipeline AS PERMISSIVE FOR SELECT TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Advisors can save investment profiles" ON public.investment_profiles;
CREATE POLICY "Advisors can save investment profiles" ON public.investment_profiles AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS "Advisors can view investment profiles" ON public.investment_profiles;
CREATE POLICY "Advisors can view investment profiles" ON public.investment_profiles AS PERMISSIVE FOR SELECT TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Staff can manage invoice line items" ON public.invoice_line_items;
CREATE POLICY "Staff can manage invoice line items" ON public.invoice_line_items AS PERMISSIVE FOR ALL TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS "Staff can manage invoice payments" ON public.invoice_payments;
CREATE POLICY "Staff can manage invoice payments" ON public.invoice_payments AS PERMISSIVE FOR ALL TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS "Staff can manage invoices" ON public.invoices;
CREATE POLICY "Staff can manage invoices" ON public.invoices AS PERMISSIVE FOR ALL TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS "Advisors can delete knowledge base" ON public.knowledge_base;
CREATE POLICY "Advisors can delete knowledge base" ON public.knowledge_base AS PERMISSIVE FOR DELETE TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Advisors can update knowledge base" ON public.knowledge_base;
CREATE POLICY "Advisors can update knowledge base" ON public.knowledge_base AS PERMISSIVE FOR UPDATE TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Advisors can view knowledge base" ON public.knowledge_base;
CREATE POLICY "Advisors can view knowledge base" ON public.knowledge_base AS PERMISSIVE FOR SELECT TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Advisors can delete liabilities" ON public.liabilities;
CREATE POLICY "Advisors can delete liabilities" ON public.liabilities AS PERMISSIVE FOR DELETE TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Advisors can update liabilities" ON public.liabilities;
CREATE POLICY "Advisors can update liabilities" ON public.liabilities AS PERMISSIVE FOR UPDATE TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Advisors can view liabilities" ON public.liabilities;
CREATE POLICY "Advisors can view liabilities" ON public.liabilities AS PERMISSIVE FOR SELECT TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Staff can delete activity log" ON public.manual_activity_log;
CREATE POLICY "Staff can delete activity log" ON public.manual_activity_log AS PERMISSIVE FOR DELETE TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Staff can update activity log" ON public.manual_activity_log;
CREATE POLICY "Staff can update activity log" ON public.manual_activity_log AS PERMISSIVE FOR UPDATE TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Staff can view activity log" ON public.manual_activity_log;
CREATE POLICY "Staff can view activity log" ON public.manual_activity_log AS PERMISSIVE FOR SELECT TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Staff can view marketing update reads" ON public.marketing_update_reads;
CREATE POLICY "Staff can view marketing update reads" ON public.marketing_update_reads AS PERMISSIVE FOR SELECT TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Staff can delete marketing updates" ON public.marketing_updates;
CREATE POLICY "Staff can delete marketing updates" ON public.marketing_updates AS PERMISSIVE FOR DELETE TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Staff can update marketing updates" ON public.marketing_updates;
CREATE POLICY "Staff can update marketing updates" ON public.marketing_updates AS PERMISSIVE FOR UPDATE TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Staff can view marketing updates" ON public.marketing_updates;
CREATE POLICY "Staff can view marketing updates" ON public.marketing_updates AS PERMISSIVE FOR SELECT TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Staff can delete monthly governance reviews" ON public.monthly_governance_reviews;
CREATE POLICY "Staff can delete monthly governance reviews" ON public.monthly_governance_reviews AS PERMISSIVE FOR DELETE TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Staff can update monthly governance reviews" ON public.monthly_governance_reviews;
CREATE POLICY "Staff can update monthly governance reviews" ON public.monthly_governance_reviews AS PERMISSIVE FOR UPDATE TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS "Staff can view monthly governance reviews" ON public.monthly_governance_reviews;
CREATE POLICY "Staff can view monthly governance reviews" ON public.monthly_governance_reviews AS PERMISSIVE FOR SELECT TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Advisors can manage other asset owners" ON public.other_asset_owners;
CREATE POLICY "Advisors can manage other asset owners" ON public.other_asset_owners AS PERMISSIVE FOR ALL TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS "Advisors can delete other assets" ON public.other_assets;
CREATE POLICY "Advisors can delete other assets" ON public.other_assets AS PERMISSIVE FOR DELETE TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Advisors can update other assets" ON public.other_assets;
CREATE POLICY "Advisors can update other assets" ON public.other_assets AS PERMISSIVE FOR UPDATE TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Advisors can view other assets" ON public.other_assets;
CREATE POLICY "Advisors can view other assets" ON public.other_assets AS PERMISSIVE FOR SELECT TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Staff can manage pm_ai_teammate_runs" ON public.pm_ai_teammate_runs;
CREATE POLICY "Staff can manage pm_ai_teammate_runs" ON public.pm_ai_teammate_runs AS PERMISSIVE FOR ALL TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS "Staff can manage pm_projects" ON public.pm_projects;
CREATE POLICY "Staff can manage pm_projects" ON public.pm_projects AS PERMISSIVE FOR ALL TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS "Staff can manage pm_task_collaborators" ON public.pm_task_collaborators;
CREATE POLICY "Staff can manage pm_task_collaborators" ON public.pm_task_collaborators AS PERMISSIVE FOR ALL TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS "Staff can manage pm_task_comments" ON public.pm_task_comments;
CREATE POLICY "Staff can manage pm_task_comments" ON public.pm_task_comments AS PERMISSIVE FOR ALL TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS "Staff can manage pm_tasks" ON public.pm_tasks;
CREATE POLICY "Staff can manage pm_tasks" ON public.pm_tasks AS PERMISSIVE FOR ALL TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS "Staff can delete client notifications" ON public.portal_client_notifications;
CREATE POLICY "Staff can delete client notifications" ON public.portal_client_notifications AS PERMISSIVE FOR DELETE TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Staff can update client notifications" ON public.portal_client_notifications;
CREATE POLICY "Staff can update client notifications" ON public.portal_client_notifications AS PERMISSIVE FOR UPDATE TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Staff can view client notifications" ON public.portal_client_notifications;
CREATE POLICY "Staff can view client notifications" ON public.portal_client_notifications AS PERMISSIVE FOR SELECT TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Advisors can delete portal links" ON public.portal_links;
CREATE POLICY "Advisors can delete portal links" ON public.portal_links AS PERMISSIVE FOR DELETE TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Advisors can update portal links" ON public.portal_links;
CREATE POLICY "Advisors can update portal links" ON public.portal_links AS PERMISSIVE FOR UPDATE TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Advisors can view portal links" ON public.portal_links;
CREATE POLICY "Advisors can view portal links" ON public.portal_links AS PERMISSIVE FOR SELECT TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Staff can view portal logins" ON public.portal_logins;
CREATE POLICY "Staff can view portal logins" ON public.portal_logins AS PERMISSIVE FOR SELECT TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Staff can delete request messages" ON public.portal_request_messages;
CREATE POLICY "Staff can delete request messages" ON public.portal_request_messages AS PERMISSIVE FOR DELETE TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Staff can view request messages" ON public.portal_request_messages;
CREATE POLICY "Staff can view request messages" ON public.portal_request_messages AS PERMISSIVE FOR SELECT TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Staff can delete portal requests" ON public.portal_requests;
CREATE POLICY "Staff can delete portal requests" ON public.portal_requests AS PERMISSIVE FOR DELETE TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Staff can update portal requests" ON public.portal_requests;
CREATE POLICY "Staff can update portal requests" ON public.portal_requests AS PERMISSIVE FOR UPDATE TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Staff can view portal requests" ON public.portal_requests;
CREATE POLICY "Staff can view portal requests" ON public.portal_requests AS PERMISSIVE FOR SELECT TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Staff can view task interactions" ON public.portal_task_interactions;
CREATE POLICY "Staff can view task interactions" ON public.portal_task_interactions AS PERMISSIVE FOR SELECT TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Staff can delete portal tokens" ON public.portal_tokens;
CREATE POLICY "Staff can delete portal tokens" ON public.portal_tokens AS PERMISSIVE FOR DELETE TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Staff can update portal tokens" ON public.portal_tokens;
CREATE POLICY "Staff can update portal tokens" ON public.portal_tokens AS PERMISSIVE FOR UPDATE TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Staff can view portal tokens" ON public.portal_tokens;
CREATE POLICY "Staff can view portal tokens" ON public.portal_tokens AS PERMISSIVE FOR SELECT TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Staff can manage engagements" ON public.professional_engagements;
CREATE POLICY "Staff can manage engagements" ON public.professional_engagements AS PERMISSIVE FOR ALL TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS "Staff can manage professionals" ON public.professionals;
CREATE POLICY "Staff can manage professionals" ON public.professionals AS PERMISSIVE FOR ALL TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS "Authenticated users can view all profiles" ON public.profiles;
CREATE POLICY "Authenticated users can view all profiles" ON public.profiles AS PERMISSIVE FOR SELECT TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Staff can delete quarterly system reviews" ON public.quarterly_system_reviews;
CREATE POLICY "Staff can delete quarterly system reviews" ON public.quarterly_system_reviews AS PERMISSIVE FOR DELETE TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Staff can update quarterly system reviews" ON public.quarterly_system_reviews;
CREATE POLICY "Staff can update quarterly system reviews" ON public.quarterly_system_reviews AS PERMISSIVE FOR UPDATE TO authenticated USING (public.is_staff()) WITH CHECK (((created_by IS NULL) OR (auth.uid() = created_by) OR (created_by IS NULL)));

DROP POLICY IF EXISTS "Staff can view quarterly system reviews" ON public.quarterly_system_reviews;
CREATE POLICY "Staff can view quarterly system reviews" ON public.quarterly_system_reviews AS PERMISSIVE FOR SELECT TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Staff can delete quo activity links" ON public.quo_activity_links;
CREATE POLICY "Staff can delete quo activity links" ON public.quo_activity_links AS PERMISSIVE FOR DELETE TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Staff can update quo activity links" ON public.quo_activity_links;
CREATE POLICY "Staff can update quo activity links" ON public.quo_activity_links AS PERMISSIVE FOR UPDATE TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Staff can view quo activity links" ON public.quo_activity_links;
CREATE POLICY "Staff can view quo activity links" ON public.quo_activity_links AS PERMISSIVE FOR SELECT TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Staff can delete quo calls" ON public.quo_calls;
CREATE POLICY "Staff can delete quo calls" ON public.quo_calls AS PERMISSIVE FOR DELETE TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Staff can insert quo calls" ON public.quo_calls;
CREATE POLICY "Staff can insert quo calls" ON public.quo_calls AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS "Staff can update quo calls" ON public.quo_calls;
CREATE POLICY "Staff can update quo calls" ON public.quo_calls AS PERMISSIVE FOR UPDATE TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Staff can view quo calls" ON public.quo_calls;
CREATE POLICY "Staff can view quo calls" ON public.quo_calls AS PERMISSIVE FOR SELECT TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Staff can delete quo contact sync" ON public.quo_contact_sync;
CREATE POLICY "Staff can delete quo contact sync" ON public.quo_contact_sync AS PERMISSIVE FOR DELETE TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Staff can insert quo contact sync" ON public.quo_contact_sync;
CREATE POLICY "Staff can insert quo contact sync" ON public.quo_contact_sync AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS "Staff can update quo contact sync" ON public.quo_contact_sync;
CREATE POLICY "Staff can update quo contact sync" ON public.quo_contact_sync AS PERMISSIVE FOR UPDATE TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Staff can view quo contact sync" ON public.quo_contact_sync;
CREATE POLICY "Staff can view quo contact sync" ON public.quo_contact_sync AS PERMISSIVE FOR SELECT TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Staff can archive threads" ON public.quo_inbox_archive;
CREATE POLICY "Staff can archive threads" ON public.quo_inbox_archive AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS "Staff can unarchive threads" ON public.quo_inbox_archive;
CREATE POLICY "Staff can unarchive threads" ON public.quo_inbox_archive AS PERMISSIVE FOR DELETE TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Staff can update archive" ON public.quo_inbox_archive;
CREATE POLICY "Staff can update archive" ON public.quo_inbox_archive AS PERMISSIVE FOR UPDATE TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Staff can view archive" ON public.quo_inbox_archive;
CREATE POLICY "Staff can view archive" ON public.quo_inbox_archive AS PERMISSIVE FOR SELECT TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Staff can delete quo messages" ON public.quo_messages;
CREATE POLICY "Staff can delete quo messages" ON public.quo_messages AS PERMISSIVE FOR DELETE TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Staff can insert quo messages" ON public.quo_messages;
CREATE POLICY "Staff can insert quo messages" ON public.quo_messages AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS "Staff can update quo messages" ON public.quo_messages;
CREATE POLICY "Staff can update quo messages" ON public.quo_messages AS PERMISSIVE FOR UPDATE TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Staff can view quo messages" ON public.quo_messages;
CREATE POLICY "Staff can view quo messages" ON public.quo_messages AS PERMISSIVE FOR SELECT TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Staff can view quo webhook events" ON public.quo_webhook_events;
CREATE POLICY "Staff can view quo webhook events" ON public.quo_webhook_events AS PERMISSIVE FOR SELECT TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Advisors can delete rental properties" ON public.rental_properties;
CREATE POLICY "Advisors can delete rental properties" ON public.rental_properties AS PERMISSIVE FOR DELETE TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Advisors can update rental properties" ON public.rental_properties;
CREATE POLICY "Advisors can update rental properties" ON public.rental_properties AS PERMISSIVE FOR UPDATE TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Advisors can view rental properties" ON public.rental_properties;
CREATE POLICY "Advisors can view rental properties" ON public.rental_properties AS PERMISSIVE FOR SELECT TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Advisors can manage property owners" ON public.rental_property_owners;
CREATE POLICY "Advisors can manage property owners" ON public.rental_property_owners AS PERMISSIVE FOR ALL TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS "Advisors can manage property years" ON public.rental_property_years;
CREATE POLICY "Advisors can manage property years" ON public.rental_property_years AS PERMISSIVE FOR ALL TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS "Service can insert review queue" ON public.review_queue;
CREATE POLICY "Service can insert review queue" ON public.review_queue AS PERMISSIVE FOR INSERT TO authenticated, service_role WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS "Staff can delete review queue" ON public.review_queue;
CREATE POLICY "Staff can delete review queue" ON public.review_queue AS PERMISSIVE FOR DELETE TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Staff can update review queue" ON public.review_queue;
CREATE POLICY "Staff can update review queue" ON public.review_queue AS PERMISSIVE FOR UPDATE TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Staff can view review queue" ON public.review_queue;
CREATE POLICY "Staff can view review queue" ON public.review_queue AS PERMISSIVE FOR SELECT TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Staff can view audit logs" ON public.security_audit_logs;
CREATE POLICY "Staff can view audit logs" ON public.security_audit_logs AS PERMISSIVE FOR SELECT TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Staff can manage bookings" ON public.service_bookings;
CREATE POLICY "Staff can manage bookings" ON public.service_bookings AS PERMISSIVE FOR ALL TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS "Staff can manage services" ON public.services;
CREATE POLICY "Staff can manage services" ON public.services AS PERMISSIVE FOR ALL TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS "Staff can delete shareholders" ON public.shareholders;
CREATE POLICY "Staff can delete shareholders" ON public.shareholders AS PERMISSIVE FOR DELETE TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Staff can insert shareholders" ON public.shareholders;
CREATE POLICY "Staff can insert shareholders" ON public.shareholders AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS "Staff can update shareholders" ON public.shareholders;
CREATE POLICY "Staff can update shareholders" ON public.shareholders AS PERMISSIVE FOR UPDATE TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Staff can view shareholders" ON public.shareholders;
CREATE POLICY "Staff can view shareholders" ON public.shareholders AS PERMISSIVE FOR SELECT TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Staff can create sovereignty charters" ON public.sovereignty_charters;
CREATE POLICY "Staff can create sovereignty charters" ON public.sovereignty_charters AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS "Staff can delete sovereignty charters" ON public.sovereignty_charters;
CREATE POLICY "Staff can delete sovereignty charters" ON public.sovereignty_charters AS PERMISSIVE FOR DELETE TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Staff can update sovereignty charters" ON public.sovereignty_charters;
CREATE POLICY "Staff can update sovereignty charters" ON public.sovereignty_charters AS PERMISSIVE FOR UPDATE TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Staff can view sovereignty charters" ON public.sovereignty_charters;
CREATE POLICY "Staff can view sovereignty charters" ON public.sovereignty_charters AS PERMISSIVE FOR SELECT TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Staff can delete stabilization maps" ON public.stabilization_maps;
CREATE POLICY "Staff can delete stabilization maps" ON public.stabilization_maps AS PERMISSIVE FOR DELETE TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Staff can insert stabilization maps" ON public.stabilization_maps;
CREATE POLICY "Staff can insert stabilization maps" ON public.stabilization_maps AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS "Staff can update stabilization maps" ON public.stabilization_maps;
CREATE POLICY "Staff can update stabilization maps" ON public.stabilization_maps AS PERMISSIVE FOR UPDATE TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Staff can view stabilization maps" ON public.stabilization_maps;
CREATE POLICY "Staff can view stabilization maps" ON public.stabilization_maps AS PERMISSIVE FOR SELECT TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Staff can delete notifications" ON public.staff_notifications;
CREATE POLICY "Staff can delete notifications" ON public.staff_notifications AS PERMISSIVE FOR DELETE TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Staff can update notifications" ON public.staff_notifications;
CREATE POLICY "Staff can update notifications" ON public.staff_notifications AS PERMISSIVE FOR UPDATE TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Staff can view notifications" ON public.staff_notifications;
CREATE POLICY "Staff can view notifications" ON public.staff_notifications AS PERMISSIVE FOR SELECT TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Staff view stage2 verification audit" ON public.stage2_verification_audit;
CREATE POLICY "Staff view stage2 verification audit" ON public.stage2_verification_audit AS PERMISSIVE FOR SELECT TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Staff can delete storehouse rules" ON public.storehouse_rules;
CREATE POLICY "Staff can delete storehouse rules" ON public.storehouse_rules AS PERMISSIVE FOR DELETE TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Staff can insert storehouse rules" ON public.storehouse_rules;
CREATE POLICY "Staff can insert storehouse rules" ON public.storehouse_rules AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS "Staff can update storehouse rules" ON public.storehouse_rules;
CREATE POLICY "Staff can update storehouse rules" ON public.storehouse_rules AS PERMISSIVE FOR UPDATE TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Staff can view storehouse rules" ON public.storehouse_rules;
CREATE POLICY "Staff can view storehouse rules" ON public.storehouse_rules AS PERMISSIVE FOR SELECT TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Advisors can delete storehouses" ON public.storehouses;
CREATE POLICY "Advisors can delete storehouses" ON public.storehouses AS PERMISSIVE FOR DELETE TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Advisors can insert storehouses" ON public.storehouses;
CREATE POLICY "Advisors can insert storehouses" ON public.storehouses AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS "Advisors can update storehouses" ON public.storehouses;
CREATE POLICY "Advisors can update storehouses" ON public.storehouses AS PERMISSIVE FOR UPDATE TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Advisors can view all storehouses" ON public.storehouses;
CREATE POLICY "Advisors can view all storehouses" ON public.storehouses AS PERMISSIVE FOR SELECT TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Staff view system health logs" ON public.system_health_logs;
CREATE POLICY "Staff view system health logs" ON public.system_health_logs AS PERMISSIVE FOR SELECT TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Staff can delete task collaborators" ON public.task_collaborators;
CREATE POLICY "Staff can delete task collaborators" ON public.task_collaborators AS PERMISSIVE FOR DELETE TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Staff can insert task collaborators" ON public.task_collaborators;
CREATE POLICY "Staff can insert task collaborators" ON public.task_collaborators AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS "Staff can view task collaborators" ON public.task_collaborators;
CREATE POLICY "Staff can view task collaborators" ON public.task_collaborators AS PERMISSIVE FOR SELECT TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Staff can read ToE acceptances" ON public.toe_acceptances;
CREATE POLICY "Staff can read ToE acceptances" ON public.toe_acceptances AS PERMISSIVE FOR SELECT TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Staff view audit" ON public.vault_audit_log;
CREATE POLICY "Staff view audit" ON public.vault_audit_log AS PERMISSIVE FOR SELECT TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Staff view bulk import items" ON public.vault_bulk_import_items;
CREATE POLICY "Staff view bulk import items" ON public.vault_bulk_import_items AS PERMISSIVE FOR SELECT TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Staff manage grants" ON public.vault_collaborator_grants;
CREATE POLICY "Staff manage grants" ON public.vault_collaborator_grants AS PERMISSIVE FOR ALL TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS "Staff manage collaborators" ON public.vault_collaborators;
CREATE POLICY "Staff manage collaborators" ON public.vault_collaborators AS PERMISSIVE FOR ALL TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS "Staff manage contact grants" ON public.vault_contact_grants;
CREATE POLICY "Staff manage contact grants" ON public.vault_contact_grants AS PERMISSIVE FOR ALL TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS "Staff manage contact roles" ON public.vault_contact_roles;
CREATE POLICY "Staff manage contact roles" ON public.vault_contact_roles AS PERMISSIVE FOR ALL TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS "Staff manage vault files" ON public.vault_files;
CREATE POLICY "Staff manage vault files" ON public.vault_files AS PERMISSIVE FOR ALL TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS "Staff manage templates" ON public.vault_folder_templates;
CREATE POLICY "Staff manage templates" ON public.vault_folder_templates AS PERMISSIVE FOR ALL TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS "Staff manage share links" ON public.vault_share_links;
CREATE POLICY "Staff manage share links" ON public.vault_share_links AS PERMISSIVE FOR ALL TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS "Staff manage shoebox proposals" ON public.vault_shoebox_proposals;
CREATE POLICY "Staff manage shoebox proposals" ON public.vault_shoebox_proposals AS PERMISSIVE FOR ALL TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS "Advisors can manage veem payer details" ON public.veem_payer_details;
CREATE POLICY "Advisors can manage veem payer details" ON public.veem_payer_details AS PERMISSIVE FOR ALL TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS "Staff can delete vineyard accounts" ON public.vineyard_accounts;
CREATE POLICY "Staff can delete vineyard accounts" ON public.vineyard_accounts AS PERMISSIVE FOR DELETE TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Staff can insert vineyard accounts" ON public.vineyard_accounts;
CREATE POLICY "Staff can insert vineyard accounts" ON public.vineyard_accounts AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS "Staff can update vineyard accounts" ON public.vineyard_accounts;
CREATE POLICY "Staff can update vineyard accounts" ON public.vineyard_accounts AS PERMISSIVE FOR UPDATE TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Staff can view vineyard accounts" ON public.vineyard_accounts;
CREATE POLICY "Staff can view vineyard accounts" ON public.vineyard_accounts AS PERMISSIVE FOR SELECT TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Staff can delete waterfall priorities" ON public.waterfall_priorities;
CREATE POLICY "Staff can delete waterfall priorities" ON public.waterfall_priorities AS PERMISSIVE FOR DELETE TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Staff can insert waterfall priorities" ON public.waterfall_priorities;
CREATE POLICY "Staff can insert waterfall priorities" ON public.waterfall_priorities AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS "Staff can update waterfall priorities" ON public.waterfall_priorities;
CREATE POLICY "Staff can update waterfall priorities" ON public.waterfall_priorities AS PERMISSIVE FOR UPDATE TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Staff can view waterfall priorities" ON public.waterfall_priorities;
CREATE POLICY "Staff can view waterfall priorities" ON public.waterfall_priorities AS PERMISSIVE FOR SELECT TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Advisors can delete knowledge files" ON storage.objects;
CREATE POLICY "Advisors can delete knowledge files" ON storage.objects AS PERMISSIVE FOR DELETE TO authenticated USING (((bucket_id = 'knowledge-base'::text)) AND public.is_staff());

DROP POLICY IF EXISTS "Advisors can upload knowledge files" ON storage.objects;
CREATE POLICY "Advisors can upload knowledge files" ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((bucket_id = 'knowledge-base'::text)) AND public.is_staff());

DROP POLICY IF EXISTS "Advisors can view knowledge files" ON storage.objects;
CREATE POLICY "Advisors can view knowledge files" ON storage.objects AS PERMISSIVE FOR SELECT TO authenticated USING (((bucket_id = 'knowledge-base'::text)) AND public.is_staff());

-- Functions that run with their owner's rights must not be callable by anyone. push_ping, callable by anyone, could start any briefing-service job with the cron secret; the trigger functions
-- need no caller rights. verify_vault_audit_chain stays available to signed-in staff but not to anonymous callers.
REVOKE ALL ON FUNCTION public.push_ping(text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.push_ping(text, jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.push_on_inbound_text() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.push_on_staff_notification() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_regulated_delete() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.holding_tank_default_household() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.verify_vault_audit_chain() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.verify_vault_audit_chain() TO authenticated, service_role;
