-- Replies to Georgia's reminders: which Gmail threads/messages belong to a case, and what has already been handled.
ALTER TABLE public.onboarding_cases
  ADD COLUMN IF NOT EXISTS thread_ids text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS sent_message_ids text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS handled_message_ids text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS snoozed_until timestamptz;
