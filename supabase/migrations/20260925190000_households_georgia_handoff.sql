-- Georgia strategy update, Phase D: smart onboarding.
-- When a paying client came from a Georgia diagnostic, enrollPaidBooking
-- pre-fills the wealth event from their spoke (wealth_event_source records
-- that it came from the diagnostic, not the client) and stores a
-- personalized onboarding intro built from their spoke + primary friction.
ALTER TABLE public.households
  ADD COLUMN IF NOT EXISTS wealth_event_source text,
  ADD COLUMN IF NOT EXISTS onboarding_intro_text text;
