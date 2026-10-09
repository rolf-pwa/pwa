-- Each staff member's email signature, appended to emails sent from the contact record.
-- Plain text; blank means no signature. Own-row update is already allowed by the profiles RLS.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email_signature text;
