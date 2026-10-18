-- Georgia's inbox sweep (read-only stage): she sorts recent inbox mail into buckets and proposes what to do with it.
-- Nothing in Gmail is changed. Rolf marks each proposal right or wrong so her accuracy can be judged before she is given any power.
--   bucket  needs_you   a person or deadline that needs Rolf
--           fyi         worth knowing, no action
--           archivable  noise she would archive once allowed
--           client      from a client or household: always shown, never touched
CREATE TABLE IF NOT EXISTS public.inbox_sweep_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  message_id text NOT NULL,
  thread_id text,
  from_addr text NOT NULL DEFAULT '',
  subject text NOT NULL DEFAULT '',
  snippet text NOT NULL DEFAULT '',
  received_at timestamptz,
  bucket text NOT NULL CHECK (bucket IN ('needs_you', 'fyi', 'archivable', 'client')),
  reason text NOT NULL DEFAULT '',
  decided_by text NOT NULL DEFAULT 'rule' CHECK (decided_by IN ('rule', 'model')),
  feedback text CHECK (feedback IN ('right', 'wrong')),
  swept_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, message_id)
);
CREATE INDEX IF NOT EXISTS idx_inbox_sweep_user_time ON public.inbox_sweep_items (user_id, received_at DESC);

ALTER TABLE public.inbox_sweep_items ENABLE ROW LEVEL SECURITY;
-- Service role only: staff read and mark these through the inbox-sweep function.
CREATE POLICY "Service manage inbox sweep items" ON public.inbox_sweep_items FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT ALL ON public.inbox_sweep_items TO service_role;
