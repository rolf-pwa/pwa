-- Bring back the "tag other household members on a task" capability the
-- old Asana setup had, natively in pm_task_collaborators (previously
-- professional-only, built for the Pro Portal task migration). Mirrors
-- that table's own shape: nullable professional_id, new nullable
-- contact_id, exactly one set per row -- enforced in code (matching this
-- codebase's established convention for mutually-exclusive owner columns),
-- not a DB constraint.
ALTER TABLE public.pm_task_collaborators
  ALTER COLUMN professional_id DROP NOT NULL,
  ADD COLUMN contact_id UUID REFERENCES public.contacts(id) ON DELETE CASCADE;

-- Nullable contact_id is safe here: Postgres treats every NULL as distinct,
-- so the existing all-professional rows (contact_id always null) never
-- collide with this new constraint.
ALTER TABLE public.pm_task_collaborators
  ADD CONSTRAINT pm_task_collaborators_task_id_contact_id_key UNIQUE (task_id, contact_id);

CREATE INDEX idx_pm_task_collaborators_contact ON public.pm_task_collaborators (contact_id);
