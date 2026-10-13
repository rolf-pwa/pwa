-- A meeting type's name here can differ from the title Google uses for its bookings on the calendar (the Interim Strategy
-- Session schedule is titled "Interim Strategy Consultation"). event_title is that calendar title, used to match reminders.
ALTER TABLE public.meeting_types ADD COLUMN IF NOT EXISTS event_title text;
UPDATE public.meeting_types SET event_title = 'Interim Strategy Consultation' WHERE label = 'Interim Strategy Session' AND event_title IS NULL;
-- Client meetings the last run saw that matched no type, so they can be added.
ALTER TABLE public.meeting_reminder_config ADD COLUMN IF NOT EXISTS last_unmatched text[] NOT NULL DEFAULT '{}';
