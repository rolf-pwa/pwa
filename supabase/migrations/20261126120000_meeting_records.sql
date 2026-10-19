-- Meeting records: when a meeting follow-up task is completed, Georgia files a standard record in the household's Advisor Files.
--   pm_tasks.meeting_followup   this task is a meeting follow-up (set on Georgia's recaps; ticked by Rolf on manual ones)
--   pm_tasks.meeting_event      the calendar event it came from, when known: { id, title, start, end, attendees: [{ name, email }] }
--   meeting_records             the Google Doc filed for a task (one per task; updated, not duplicated, if the task is closed again)
ALTER TABLE public.pm_tasks
  ADD COLUMN IF NOT EXISTS meeting_followup boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS meeting_event jsonb;

CREATE TABLE IF NOT EXISTS public.meeting_records (
  task_id uuid PRIMARY KEY REFERENCES public.pm_tasks(id) ON DELETE CASCADE,
  household_id uuid REFERENCES public.households(id) ON DELETE SET NULL,
  doc_id text NOT NULL,
  doc_url text NOT NULL,
  doc_name text NOT NULL,
  event_source text NOT NULL CHECK (event_source IN ('linked', 'matched', 'none')),
  filed_for_completion timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.meeting_records ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.meeting_records TO service_role;
