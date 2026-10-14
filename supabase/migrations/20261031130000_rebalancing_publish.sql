-- Rebalancing is prepared by Rolf family by family (days of work) and published to the family's portal when ready. Georgia
-- invites the family only after it is published, and consent is given after the client has reviewed what was published.
--   published_at / published_by   when and by whom it went to the portal
--   proposal_summary              what Rolf wrote for the client to review (shown in the portal, and stored with the consent)
--   completed_at                  when Rolf finished carrying it out
ALTER TABLE public.review_obligations
  ADD COLUMN IF NOT EXISTS published_at timestamptz,
  ADD COLUMN IF NOT EXISTS published_by uuid,
  ADD COLUMN IF NOT EXISTS proposal_summary text,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;
ALTER TABLE public.rebalance_acknowledgements ADD COLUMN IF NOT EXISTS proposal_summary text;
