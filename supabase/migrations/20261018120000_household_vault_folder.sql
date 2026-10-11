-- The "{Household} Household Vault" folder: the parent of the household's Vault root (Household Docs). Staff start
-- here to see Household Docs, Personal Docs and Advisor Files together. It is for navigation and for labelling audit
-- entries only; it is NOT an access root, because everything under an access root is open to that household's members.
ALTER TABLE public.households ADD COLUMN IF NOT EXISTS vault_folder_id text;
