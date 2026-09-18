-- AI Teammate task assignment. Single-shot draft only (one Vertex call per
-- run, scripted client-side stage UI) -- there is no multi-turn agentic loop
-- anywhere in this codebase and this migration doesn't add one.

-- A task's owner is either a human (assignee_id) or an AI Teammate persona
-- (assigned_agent_key) -- never both. Enforced in code (pm-service's
-- updateTask), matching this schema's "exactly one of X/Y" convention (e.g.
-- pm_task_comments' four author columns after this migration). Free-text,
-- not an enum/FK -- see src/shared/lib/aiTeammates.ts for the fixed
-- registry; new personas can be added there later with zero migration.
ALTER TABLE public.pm_tasks
  ADD COLUMN assigned_agent_key TEXT;

CREATE INDEX idx_pm_tasks_assigned_agent_key
  ON public.pm_tasks (assigned_agent_key) WHERE assigned_agent_key IS NOT NULL;

-- One row per AI Teammate run (one row = one Vertex request/response, never
-- a multi-turn transcript). Gives an audit trail and a place to record
-- failure, independent of the subtask/comment it produced.
CREATE TABLE public.pm_ai_teammate_runs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  task_id UUID NOT NULL REFERENCES public.pm_tasks(id) ON DELETE CASCADE,
  agent_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running', -- running | complete | error
  result_subtask_id UUID REFERENCES public.pm_tasks(id) ON DELETE SET NULL,
  result_comment_id UUID REFERENCES public.pm_task_comments(id) ON DELETE SET NULL,
  error_message TEXT,
  requested_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  completed_at TIMESTAMP WITH TIME ZONE
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pm_ai_teammate_runs TO authenticated;
GRANT ALL ON public.pm_ai_teammate_runs TO service_role;
ALTER TABLE public.pm_ai_teammate_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can manage pm_ai_teammate_runs"
  ON public.pm_ai_teammate_runs FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE INDEX idx_pm_ai_teammate_runs_task ON public.pm_ai_teammate_runs (task_id);

-- Fourth mutually-exclusive-in-code comment author (alongside author_id,
-- author_contact_id, author_professional_id). No agent identity row in
-- auth.users exists or should be created (would break StaffAssigneePicker's
-- and pm-service's `.ilike("email","%@prosperwise.ca")` staff-only queries)
-- -- the persona key is stored directly so a comment can render "AI
-- Teammate -- {label}" without a join.
ALTER TABLE public.pm_task_comments
  ADD COLUMN author_agent_key TEXT;
