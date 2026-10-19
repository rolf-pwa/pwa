-- System comments: a line in a task's thread whenever a task or one of its action items is completed or reopened (who, and when from created_at).
ALTER TABLE public.pm_task_comments
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'comment' CHECK (kind IN ('comment', 'system'));
