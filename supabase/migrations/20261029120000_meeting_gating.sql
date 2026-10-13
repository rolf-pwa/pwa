-- Meeting links by cadence. A meeting type with cadence_kind set is shown to a family only while that family owes that
-- meeting (its window is open and nothing is booked); once booked, the portal shows a "booked" message instead.
ALTER TABLE public.meeting_types
  ADD COLUMN IF NOT EXISTS cadence_kind text CHECK (cadence_kind IN ('annual_review', 'sovereignty_review', 'governance_review'));

-- A window that was already open when Georgia went live is tracked (so the portal knows what is booked) but she never
-- invites or hands over for it: invite = false.
ALTER TABLE public.review_obligations ADD COLUMN IF NOT EXISTS invite boolean NOT NULL DEFAULT true;
