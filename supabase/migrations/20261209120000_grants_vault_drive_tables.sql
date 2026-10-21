-- Supabase stops granting Data API access to new tables automatically on 2026-10-30. These three tables (created 2026-10-16) were the only recent ones
-- without an explicit grant in their migration. In production they already have access; this makes a rebuilt schema (new project, preview branch,
-- local db reset) match. Only the service role uses them.
GRANT ALL ON public.vault_drive_watch TO service_role;
GRANT ALL ON public.vault_drive_state TO service_role;
GRANT ALL ON public.vault_drive_folder_map TO service_role;
