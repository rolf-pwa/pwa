-- The date an opportunity is time-sensitive: a chargeback maturity for an F-class migration, a renewal for a policy. Lets the page sort by it.
-- Filled by the weekly run (which refreshes every finding that still fires), so older rows get a date at the next run.
ALTER TABLE public.opportunities ADD COLUMN IF NOT EXISTS due_on date;
CREATE INDEX IF NOT EXISTS idx_opportunities_due_on ON public.opportunities (due_on) WHERE due_on IS NOT NULL;
