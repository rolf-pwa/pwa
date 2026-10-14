-- A contact who has asked not to be emailed by Georgia (or whom Rolf deals with personally). Georgia's senders skip them and hand the
-- matter to a person instead. A note records why.
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS no_automated_email boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS no_automated_email_note text,
  ADD COLUMN IF NOT EXISTS no_automated_email_at timestamptz;
