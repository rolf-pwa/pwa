-- A new kind of opportunity: households whose chargeback period is about to end, with the chargeback if moved today and the monthly F-class fee.
ALTER TABLE public.opportunities DROP CONSTRAINT IF EXISTS opportunities_type_check;
ALTER TABLE public.opportunities ADD CONSTRAINT opportunities_type_check CHECK (type IN ('insurance_coverage_gap', 'debt_protection', 'charter_candidate', 'tier_upgrade', 'consolidation', 'corporate_structuring', 'estate_gap', 'idle_cash', 'policy_event', 'fclass_migration'));
