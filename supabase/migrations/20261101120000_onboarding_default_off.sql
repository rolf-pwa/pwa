-- A household added by hand (an existing relationship, a new household in a VFO family) must not be onboarded by Georgia by default:
-- she emails new clients on her own. Paid Sovereignty Surveys switch it on explicitly (booking-enrollment sets it true), and staff can
-- switch it on from the household's "Audit onboarding" switch.
ALTER TABLE public.households ALTER COLUMN onboarding_enabled SET DEFAULT false;
