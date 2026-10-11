-- The "{Family} Family Vault" folder: the top of a family's Drive tree. Navigation and layout only (access roots are
-- Family Docs, Household Docs and each personal drawer). Lets a second household added to the family be provisioned
-- into the same tree.
ALTER TABLE public.families ADD COLUMN IF NOT EXISTS vault_folder_id text;
