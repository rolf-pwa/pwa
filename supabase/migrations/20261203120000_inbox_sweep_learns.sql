-- The inbox sweep learns from Rolf's corrections.
--   inbox_sweep_items.correct_bucket    where Rolf said the message belonged, when he marked it wrong
--   inbox_sweep_items.proposed_bucket   what Georgia first proposed (accuracy is judged on this, even after the item is moved)
--   inbox_sweep_senders                 senders Rolf has told Georgia belong in a bucket; they are sorted that way from then on
ALTER TABLE public.inbox_sweep_items
  ADD COLUMN IF NOT EXISTS correct_bucket text CHECK (correct_bucket IN ('needs_you', 'fyi', 'archivable')),
  ADD COLUMN IF NOT EXISTS proposed_bucket text CHECK (proposed_bucket IN ('needs_you', 'fyi', 'archivable', 'client'));
UPDATE public.inbox_sweep_items SET proposed_bucket = bucket WHERE proposed_bucket IS NULL;

ALTER TABLE public.inbox_sweep_items DROP CONSTRAINT IF EXISTS inbox_sweep_items_decided_by_check;
ALTER TABLE public.inbox_sweep_items ADD CONSTRAINT inbox_sweep_items_decided_by_check CHECK (decided_by IN ('rule', 'model', 'learned'));

CREATE TABLE IF NOT EXISTS public.inbox_sweep_senders (
  user_id uuid NOT NULL,
  sender text NOT NULL,
  bucket text NOT NULL CHECK (bucket IN ('needs_you', 'fyi', 'archivable')),
  source text NOT NULL DEFAULT 'corrected' CHECK (source IN ('corrected', 'told')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, sender)
);
ALTER TABLE public.inbox_sweep_senders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service manage inbox sweep senders" ON public.inbox_sweep_senders FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT ALL ON public.inbox_sweep_senders TO service_role;
