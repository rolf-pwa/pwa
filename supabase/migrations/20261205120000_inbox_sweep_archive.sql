-- Georgia can archive swept mail when Rolf tells her to. Archiving only removes the Inbox label; nothing is deleted.
--   archived_at    when the message left the Inbox through a sweep archive (or was found already gone, with no batch)
--   archive_batch  groups what one archive moved, so "undo" can put exactly that batch back
--   undone_at      set when a batch was put back; such a message is never archived again by a bulk archive
ALTER TABLE public.inbox_sweep_items
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS archive_batch uuid,
  ADD COLUMN IF NOT EXISTS undone_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_inbox_sweep_batch ON public.inbox_sweep_items (user_id, archive_batch) WHERE archive_batch IS NOT NULL;
