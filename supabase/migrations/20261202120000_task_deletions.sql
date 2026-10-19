-- Staff can delete a task. A copy of what was deleted is kept here (the task, its action items and its comments), for the record.
CREATE TABLE IF NOT EXISTS public.pm_task_deletions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL,
  title text NOT NULL,
  contact_id uuid,
  household_id uuid,
  snapshot jsonb NOT NULL,
  deleted_by uuid,
  deleted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pm_task_deletions_contact ON public.pm_task_deletions (contact_id, deleted_at DESC);
ALTER TABLE public.pm_task_deletions ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.pm_task_deletions TO service_role;
