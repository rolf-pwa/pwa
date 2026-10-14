-- iA's published model portfolios. A client's Investor Profile points at one of these; the Portfolio Review pack measures an account against the
-- profile's income range (the line iA itself uses on statements) and lists the funds the model holds. When iA reissues the document a new as_of
-- is added and the newest set is used. Loaded from "iA Model Portfolios as at May 31, 2026.pdf" (pages 7 to 12).
CREATE TABLE IF NOT EXISTS public.ia_model_portfolios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  as_of date NOT NULL,
  profile_key text NOT NULL,
  label text NOT NULL,
  sort_order int NOT NULL,
  income_min numeric NOT NULL,
  income_max numeric NOT NULL,
  equity_min numeric NOT NULL,
  equity_max numeric NOT NULL,
  -- The model's own fixed income weight: the point target within the range.
  income_target numeric NOT NULL,
  funds jsonb NOT NULL DEFAULT '[]'::jsonb,
  source_file text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (as_of, profile_key)
);
ALTER TABLE public.ia_model_portfolios ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service manage ia model portfolios" ON public.ia_model_portfolios FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT ALL ON public.ia_model_portfolios TO service_role;

INSERT INTO public.ia_model_portfolios (as_of, profile_key, label, sort_order, income_min, income_max, equity_min, equity_max, income_target, funds, source_file) VALUES
  ('2026-05-31', 'prudent', 'Prudent', 1, 65, 100, 0, 35, 70, '[{"name": "Fixed income managed portfolio (iA)", "weight": 70}, {"name": "Canadian Equity Growth (iA)", "weight": 10}, {"name": "Fidelity Insights", "weight": 10}, {"name": "Fidelity Global Concentrated Equity", "weight": 10}]'::jsonb, 'iA Model Portfolios as at May 31, 2026.pdf'),
  ('2026-05-31', 'moderate', 'Moderate', 2, 50, 70, 30, 50, 55, '[{"name": "Fixed income managed portfolio (iA)", "weight": 55}, {"name": "Canadian Equity Growth (iA)", "weight": 15}, {"name": "Fidelity Insights", "weight": 20}, {"name": "Fidelity Global Concentrated Equity", "weight": 10}]'::jsonb, 'iA Model Portfolios as at May 31, 2026.pdf'),
  ('2026-05-31', 'balanced', 'Balanced', 3, 35, 55, 45, 65, 40, '[{"name": "Fixed income managed portfolio (iA)", "weight": 40}, {"name": "Canadian Equity Growth (iA)", "weight": 10}, {"name": "Fidelity Canadian Opportunities", "weight": 10}, {"name": "Fidelity Insights", "weight": 20}, {"name": "Fidelity Global Concentrated Equity", "weight": 20}]'::jsonb, 'iA Model Portfolios as at May 31, 2026.pdf'),
  ('2026-05-31', 'growth', 'Growth', 4, 20, 40, 60, 80, 25, '[{"name": "Fixed income managed portfolio (iA)", "weight": 25}, {"name": "Canadian Equity Growth (iA)", "weight": 15}, {"name": "Fidelity Canadian Opportunities", "weight": 10}, {"name": "Fidelity Insights", "weight": 25}, {"name": "Fidelity Global Concentrated Equity", "weight": 25}]'::jsonb, 'iA Model Portfolios as at May 31, 2026.pdf'),
  ('2026-05-31', 'aggressive', 'Aggressive', 5, 0, 25, 75, 100, 0, '[{"name": "Canadian Equity Growth (iA)", "weight": 15}, {"name": "Fidelity Canadian Opportunities", "weight": 15}, {"name": "Fidelity Insights", "weight": 30}, {"name": "Fidelity Global Concentrated Equity", "weight": 30}, {"name": "Fidelity Global Innovators", "weight": 10}]'::jsonb, 'iA Model Portfolios as at May 31, 2026.pdf')
ON CONFLICT (as_of, profile_key) DO NOTHING;

-- An Investor Profile is now chosen from the models (or is custom). Existing profiles named after a model are linked to it.
ALTER TABLE public.investor_profiles ADD COLUMN IF NOT EXISTS profile_key text;
UPDATE public.investor_profiles SET profile_key = lower(label) WHERE profile_key IS NULL AND lower(label) IN ('prudent','moderate','balanced','growth','aggressive');
