-- One row per person per import month: records that Georgia told them their balances are updated, so a click can
-- never notify the same person twice for the same month. Service role only (read and written by balance-update-notify).
CREATE TABLE IF NOT EXISTS public.balance_update_notices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_date date NOT NULL,
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  portal_notified boolean NOT NULL DEFAULT false,
  email_sent boolean NOT NULL DEFAULT false,
  sent_by uuid,
  sent_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (snapshot_date, contact_id)
);
ALTER TABLE public.balance_update_notices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service manage balance update notices" ON public.balance_update_notices FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT ALL ON public.balance_update_notices TO service_role;
