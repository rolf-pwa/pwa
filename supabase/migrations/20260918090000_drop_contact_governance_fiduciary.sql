-- Every reader/writer of governance_status/fiduciary_entity was migrated
-- to read/write via the linked household instead (see the "Read/write
-- governance_status & fiduciary_entity via households everywhere" commit,
-- merged and deployed to main first, deliberately, to avoid a window
-- where the then-live frontend would query a column that no longer
-- exists). households.governance_status/fiduciary_entity remain the
-- single source of truth going forward.
ALTER TABLE public.contacts
  DROP COLUMN governance_status,
  DROP COLUMN fiduciary_entity;
