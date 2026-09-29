-- Quo SMS send failures were invisible: when the call to OpenPhone throws,
-- nothing gets persisted, so a genuine failure and a "OpenPhone actually
-- sent it, we just never heard back" case look identical to staff and leave
-- no forensic trail. sendSms now records the attempt before calling
-- OpenPhone and updates it after, so every attempt has a row.
ALTER TABLE public.quo_messages ADD COLUMN IF NOT EXISTS error_detail text;
