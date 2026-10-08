-- Lets staff count the unused part of a revolving credit line (a HELOC, say) toward the Strategic Reserve. The credit is
-- reserve CAPACITY, not an asset: documents show it beside the reserve but keep it out of Total Assets and Net Worth.
ALTER TABLE public.liabilities ADD COLUMN IF NOT EXISTS credit_in_strategic boolean NOT NULL DEFAULT false;
