-- Household Liabilities tab: HELOC as its own liability type, and a credit limit for revolving credit
-- (HELOC, credit card, line of credit). Credit available = limit - balance, computed in the app.
-- Strictly additive; the liabilities table and its policies already exist.
ALTER TYPE public.liability_type ADD VALUE IF NOT EXISTS 'heloc';
ALTER TABLE public.liabilities ADD COLUMN IF NOT EXISTS credit_limit numeric;
