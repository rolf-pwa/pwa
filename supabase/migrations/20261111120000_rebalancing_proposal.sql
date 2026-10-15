-- The Tier 1 rebalancing now carries the engine's proposal (switches by asset class and death benefit resets), frozen when Rolf publishes, and the
-- client's acknowledgement records which items they reviewed.
ALTER TABLE public.review_obligations ADD COLUMN IF NOT EXISTS proposal jsonb;
ALTER TABLE public.rebalance_acknowledgements ADD COLUMN IF NOT EXISTS items jsonb;
