-- Harvest to date on the Sovereignty Review = total of ALL withdrawals from the account, from every fund.
-- Replaces the income-fund-only columns added in 20261007150000 (never populated), so they are dropped.
ALTER TABLE public.holding_tank
  DROP COLUMN IF EXISTS income_withdrawals_ytd,
  DROP COLUMN IF EXISTS income_withdrawals_as_of,
  ADD COLUMN IF NOT EXISTS withdrawals_ytd numeric,
  ADD COLUMN IF NOT EXISTS withdrawals_as_of date;
ALTER TABLE public.vineyard_accounts
  DROP COLUMN IF EXISTS income_withdrawals_ytd,
  DROP COLUMN IF EXISTS income_withdrawals_as_of,
  ADD COLUMN IF NOT EXISTS withdrawals_ytd numeric,
  ADD COLUMN IF NOT EXISTS withdrawals_as_of date;
