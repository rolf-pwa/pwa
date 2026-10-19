-- Staff can edit a staff or Georgia comment (for example Georgia's draft recap, before it is released to the client).
-- Every earlier version is kept, and the comment shows that it was edited.
ALTER TABLE public.pm_task_comments
  ADD COLUMN IF NOT EXISTS edited_at timestamptz,
  ADD COLUMN IF NOT EXISTS edited_by uuid;

CREATE TABLE IF NOT EXISTS public.pm_task_comment_edits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  comment_id uuid NOT NULL REFERENCES public.pm_task_comments(id) ON DELETE CASCADE,
  previous_body text NOT NULL,
  previous_format text NOT NULL,
  edited_by uuid,
  edited_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pm_task_comment_edits_comment ON public.pm_task_comment_edits (comment_id, edited_at);

ALTER TABLE public.pm_task_comment_edits ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.pm_task_comment_edits TO service_role;
