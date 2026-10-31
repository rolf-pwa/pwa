-- Accepting an opportunity creates a task for staff; keep the link so a second click never makes a second task,
-- and a status for "taken up, task open" between open and converted.
ALTER TABLE public.opportunities DROP CONSTRAINT IF EXISTS opportunities_status_check;
ALTER TABLE public.opportunities ADD CONSTRAINT opportunities_status_check CHECK (status IN ('open', 'snoozed', 'accepted', 'dismissed', 'converted', 'resolved'));
ALTER TABLE public.opportunities ADD COLUMN IF NOT EXISTS task_id uuid REFERENCES public.pm_tasks(id) ON DELETE SET NULL;
