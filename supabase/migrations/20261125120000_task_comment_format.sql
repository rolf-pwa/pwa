-- Task comments can be formatted (HTML) when staff write them; clients' comments stay plain text.
-- The page cleans HTML before showing it; only staff can create an 'html' comment.
ALTER TABLE public.pm_task_comments
  ADD COLUMN IF NOT EXISTS body_format text NOT NULL DEFAULT 'text' CHECK (body_format IN ('text', 'html'));
