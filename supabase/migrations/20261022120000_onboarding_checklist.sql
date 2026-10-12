-- Georgia's onboarding checklist: the parent task and its subtasks (pm_tasks) created for a live case.
ALTER TABLE public.onboarding_cases ADD COLUMN IF NOT EXISTS checklist jsonb NOT NULL DEFAULT '{}'::jsonb;
