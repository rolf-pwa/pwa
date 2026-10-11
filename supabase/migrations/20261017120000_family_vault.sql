-- Family Vault and personal drawers (VFO families).
--  * families.vault_root_folder_id: the Family Vault folder in Drive (shared by the family, role-based access)
--  * contacts.personal_vault_folder_id: a personal drawer, open only to its owner and to staff
-- Both live OUTSIDE every household's Vault root, so household members cannot reach them by the household's access.
ALTER TABLE public.families ADD COLUMN IF NOT EXISTS vault_root_folder_id text;
ALTER TABLE public.families ADD COLUMN IF NOT EXISTS vault_root_provisioned_at timestamptz;
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS personal_vault_folder_id text;
CREATE UNIQUE INDEX IF NOT EXISTS families_vault_root_unique ON public.families (vault_root_folder_id) WHERE vault_root_folder_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS contacts_personal_vault_unique ON public.contacts (personal_vault_folder_id) WHERE personal_vault_folder_id IS NOT NULL;
