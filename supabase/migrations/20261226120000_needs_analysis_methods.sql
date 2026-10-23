-- Disability and critical illness needs analyses are saved in the same table as the life (DIME) ones, told apart by method.
ALTER TABLE public.insurance_needs_analyses DROP CONSTRAINT IF EXISTS insurance_needs_analyses_method_check;
ALTER TABLE public.insurance_needs_analyses ADD CONSTRAINT insurance_needs_analyses_method_check CHECK (method IN ('dime', 'disability', 'critical_illness'));
