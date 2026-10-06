-- Withdrawals taken from income funds (HISA / income / money-market / cash) in the statement period, read
-- from the statement's fund-level transaction details by the V2 scan and kept after advisor approval.
-- Nullable: null = not read from a statement. Used by the Sovereignty Review's "Harvest to date".
ALTER TABLE public.holding_tank
  ADD COLUMN IF NOT EXISTS income_withdrawals_ytd numeric,
  ADD COLUMN IF NOT EXISTS income_withdrawals_as_of date;
ALTER TABLE public.vineyard_accounts
  ADD COLUMN IF NOT EXISTS income_withdrawals_ytd numeric,
  ADD COLUMN IF NOT EXISTS income_withdrawals_as_of date;
