-- A saved needs analysis can be filed as a branded PDF in the household's Advisor Files (and attached to an insurance file as the needs-analysis evidence).
ALTER TABLE public.insurance_needs_analyses
  ADD COLUMN IF NOT EXISTS pdf_drive_id text,
  ADD COLUMN IF NOT EXISTS pdf_url text,
  ADD COLUMN IF NOT EXISTS filed_at timestamptz;
