-- Georgia entry links (?event= / ?source=): record where a lead came from.
-- georgia2_sessions.source already exists; this adds it to the lead so the
-- attribution survives once a session becomes a lead.
ALTER TABLE public.georgia2_leads ADD COLUMN IF NOT EXISTS source text;
