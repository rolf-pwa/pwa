-- Real per-step funnel tracking for the Georgia 2.0 wealth-event diagnostic
-- (Domain -> Catalyst -> Diagnostic -> Pathway -> Confidential). Today's
-- tracking only distinguishes three coarse phases ("chat" lumps Domain,
-- Catalyst, and Diagnostic together, then "lead_capture", then
-- "complete") -- not enough to see where within that first stretch
-- visitors actually stop. Rolf flagged real engagement (avg ~11 min) with
-- very few captured leads; this is the instrumentation needed to confirm
-- (not just hypothesize) where the drop-off actually happens before
-- deciding how big a flow change to make.
--
-- One nullable timestamp per Stepper-labeled step, set client-side the
-- first time that step is reached (never overwritten on a later revisit
-- via Back/forward), so each column is a true first-reach time --
-- directly usable for a funnel count (how many sessions have
-- step_pathway_reached_at set, out of how many have
-- step_domain_reached_at set) and, longer term, time-per-step.

ALTER TABLE public.georgia2_sessions
  ADD COLUMN step_domain_reached_at TIMESTAMPTZ,
  ADD COLUMN step_catalyst_reached_at TIMESTAMPTZ,
  ADD COLUMN step_diagnostic_reached_at TIMESTAMPTZ,
  ADD COLUMN step_pathway_reached_at TIMESTAMPTZ,
  ADD COLUMN step_confidential_reached_at TIMESTAMPTZ;
