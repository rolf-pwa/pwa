-- A filed planning report can be shared with the people it was prepared for: they then see it, and can download it, on their portal Documents page.
-- Unsharing hides it again; the filed PDF is never touched.
ALTER TABLE public.insurance_reports
  ADD COLUMN IF NOT EXISTS shared_at timestamptz,
  ADD COLUMN IF NOT EXISTS shared_by text;
