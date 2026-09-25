-- Georgia strategy update, Phase A: store the spoke (the doc's 7-value event
-- enum) and the Hub variables derived from a diagnostic, plus the combined
-- handoff payload. All nullable -- historical rows predate them. Values are
-- derived deterministically client-side from the chosen answers and
-- validated against fixed enums in georgia2-lead; no LLM is involved.
ALTER TABLE public.georgia2_sessions
  ADD COLUMN IF NOT EXISTS spoke text;

ALTER TABLE public.georgia2_leads
  ADD COLUMN IF NOT EXISTS spoke text,
  ADD COLUMN IF NOT EXISTS emotional_state text,
  ADD COLUMN IF NOT EXISTS relational_state text,
  ADD COLUMN IF NOT EXISTS timeline_urgency text,
  ADD COLUMN IF NOT EXISTS primary_friction text,
  ADD COLUMN IF NOT EXISTS diagnostic_payload jsonb;
