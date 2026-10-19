-- Georgia as an assignee: tasks she works on her own, and tasks that repeat.
--   pm_tasks.recurrence      { every: week|month|year, interval, owner: georgia|same }: completing the task makes the next one
--   pm_tasks.recurred_from   the task this one repeats; unique, so a task makes at most one next task
--   pm_tasks.agent_attempts  how many times Georgia has tried a task assigned to her (she hands it to Rolf after three)
ALTER TABLE public.pm_tasks
  ADD COLUMN IF NOT EXISTS recurrence jsonb,
  ADD COLUMN IF NOT EXISTS recurred_from uuid REFERENCES public.pm_tasks(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS agent_attempts integer NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX IF NOT EXISTS uq_pm_tasks_recurred_from ON public.pm_tasks (recurred_from) WHERE recurred_from IS NOT NULL;

-- Every 15 minutes: Georgia picks up what is assigned to her.
SELECT cron.schedule(
  'georgia-tasks',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'https://rpxevcovasrgmrzkpknu.supabase.co/functions/v1/daily-briefing-generate',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-daily-briefing-cron-secret', coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'daily_briefing_cron_secret'), '')),
    body := '{"job":"georgia_tasks"}'::jsonb
  );
  $$
);
