-- A reminder recorded as already handled elsewhere (Google sent it) so Georgia never sends it. Shown as "Skipped".
ALTER TABLE public.meeting_reminders ADD COLUMN IF NOT EXISTS note text;
