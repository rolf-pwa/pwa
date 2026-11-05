-- The Liquidity Reserve the Charter sets for a household. The VFO portal's "Available to draw this year" is this amount less the withdrawals so far
-- this year, never more than the income funds held. Optional: without it nothing is shown. Deliberately not the Liquidity storehouse's target:
-- a storehouse target would mark the Liquidity Reserve as "set up" and stop the income funds being counted as it.
ALTER TABLE public.households ADD COLUMN IF NOT EXISTS liquidity_reserve_amount numeric CHECK (liquidity_reserve_amount IS NULL OR liquidity_reserve_amount >= 0);
