-- A document waiting for the client is found on the documents card on their dashboard, so its task no longer also appears in their Action Items. The task stays as the
-- advisor's own tracker (and is what the client notification is sent for); it is simply not client-visible. This hides the tasks of documents already sent.
UPDATE public.pm_tasks SET client_visible = false
WHERE client_visible = true AND id IN (SELECT task_id FROM public.insurance_documents WHERE task_id IS NOT NULL);
