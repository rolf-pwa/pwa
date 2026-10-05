-- Phase 2 of "Available for withdrawal this year": remember, per account, the value held in
-- income-type holdings (income / fixed-income funds, money market, cash, HISA) from the last
-- advisor-approved V2 review, and the statement date it was read from. The account cards compute
-- the available amount live from this plus the account's own book/current value, so it never goes
-- stale against a newer balance.
--
-- Strictly additive: two nullable columns on each table, no default (metadata-only change, no
-- table rewrite), no change to existing rows or policies. Written only by stage2-review when an
-- advisor approves a CONFIRMED extraction; V1 paths never touch them. `storehouses` is not
-- included (withdrawals are drawn from Vineyard and Holding Tank accounts).
ALTER TABLE public.holding_tank
  ADD COLUMN IF NOT EXISTS income_funds_value numeric,
  ADD COLUMN IF NOT EXISTS income_funds_as_of date;

ALTER TABLE public.vineyard_accounts
  ADD COLUMN IF NOT EXISTS income_funds_value numeric,
  ADD COLUMN IF NOT EXISTS income_funds_as_of date;

COMMENT ON COLUMN public.holding_tank.income_funds_value IS 'Value held in income-type holdings per the last approved V2 statement review (null = not recorded).';
COMMENT ON COLUMN public.holding_tank.income_funds_as_of IS 'Statement date income_funds_value was read from.';
COMMENT ON COLUMN public.vineyard_accounts.income_funds_value IS 'Value held in income-type holdings per the last approved V2 statement review (null = not recorded).';
COMMENT ON COLUMN public.vineyard_accounts.income_funds_as_of IS 'Statement date income_funds_value was read from.';
