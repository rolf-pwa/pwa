-- Georgia strategy update, Phase B: optional free-text answer, threat
-- screening, and a stored validation paragraph.
--   georgia2_sessions.analyze_count   -- per-session cap on georgia2-analyze (a public,
--                                        unauthenticated endpoint that calls Vertex)
--   georgia2_leads.validation_text    -- the 2-3 sentence acknowledgment shown on the
--                                        results screen and in the emailed roadmap
--   georgia2_leads.freeform_extraction-- {threat_detected, threat_source, emotional_state,
--                                        primary_friction} from the free-text answer
-- The raw free text itself goes in the existing unstructured_stress_quote column.
ALTER TABLE public.georgia2_sessions
  ADD COLUMN IF NOT EXISTS analyze_count integer NOT NULL DEFAULT 0;

ALTER TABLE public.georgia2_leads
  ADD COLUMN IF NOT EXISTS validation_text text,
  ADD COLUMN IF NOT EXISTS freeform_extraction jsonb;
