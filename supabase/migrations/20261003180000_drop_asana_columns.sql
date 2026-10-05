-- Asana is fully deprecated and its code removed (see the remove-asana change).
-- Drops the three columns that only ever held Asana pointers. No CASCADE on
-- purpose: if any view/policy still depended on one of these, the migration
-- should fail loudly rather than drop it silently. Their indexes
-- (idx_pm_tasks_asana_gid_contact / _project) go with the column.
--   contacts.asana_url                 -- link to the contact's Asana task/project
--   corporations.asana_project_url     -- link to the corporation's Asana project
--   pm_tasks.asana_gid                 -- provenance/dedup key for the Asana backfill/import
-- The asana_sync_state / asana_sync_events tables are not touched here.
ALTER TABLE public.contacts DROP COLUMN IF EXISTS asana_url;
ALTER TABLE public.corporations DROP COLUMN IF EXISTS asana_project_url;
ALTER TABLE public.pm_tasks DROP COLUMN IF EXISTS asana_gid;
