-- An Ask Georgia request is acknowledged and closed at once; anything further continues in a client-visible task.
-- pm_tasks.portal_request_id links the task to the request it came from.
ALTER TABLE public.pm_tasks ADD COLUMN IF NOT EXISTS portal_request_id uuid REFERENCES public.portal_requests(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_pm_tasks_portal_request ON public.pm_tasks (portal_request_id) WHERE portal_request_id IS NOT NULL;
