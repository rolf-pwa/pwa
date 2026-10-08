-- Where a start-of-year (BOY) value came from: read off a statement's own beginning-of-year figure, or the prior
-- year-end statement's closing value used as the fallback. NULL = imported by the quarterly sync.
ALTER TABLE public.account_harvest_snapshots ADD COLUMN IF NOT EXISTS boy_source text;
ALTER TABLE public.account_harvest_snapshots DROP CONSTRAINT IF EXISTS account_harvest_snapshots_boy_source_check;
ALTER TABLE public.account_harvest_snapshots ADD CONSTRAINT account_harvest_snapshots_boy_source_check CHECK (boy_source IS NULL OR boy_source IN ('statement', 'prior_year_end'));
