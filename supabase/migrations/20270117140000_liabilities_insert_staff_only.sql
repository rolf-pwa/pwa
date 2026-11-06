-- The last liabilities policy still open to the public role: anyone signed in could insert a row for themselves. Staff only, still as the row's creator.
DROP POLICY IF EXISTS "Advisors can insert liabilities" ON public.liabilities;
CREATE POLICY "Advisors can insert liabilities" ON public.liabilities AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (public.is_staff() AND auth.uid() = created_by);
