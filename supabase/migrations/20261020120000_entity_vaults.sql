-- Entity Vaults: one Drive vault per corporation (trusts follow in phase 2), nested under the home household's
-- "Entity Vaults" folder. Access is explicit per entity (entity_vault_access); ownership is display-only.
--   vault_folder_id       "{Corp} Vault" folder: navigation only
--   vault_root_folder_id  "Corporate Docs" inside it: the access root
--   home_household_id     the household whose Household Vault folder holds it
--   parent_corporation_id optional holdco -> opco link (display and grouping only; never grants access)
ALTER TABLE public.corporations
  ADD COLUMN IF NOT EXISTS vault_folder_id text,
  ADD COLUMN IF NOT EXISTS vault_root_folder_id text,
  ADD COLUMN IF NOT EXISTS vault_provisioned_at timestamptz,
  ADD COLUMN IF NOT EXISTS home_household_id uuid REFERENCES public.households(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS parent_corporation_id uuid REFERENCES public.corporations(id) ON DELETE SET NULL;

ALTER TABLE public.households ADD COLUMN IF NOT EXISTS entity_vaults_folder_id text;

CREATE TABLE IF NOT EXISTS public.entity_vault_access (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  corporation_id uuid NOT NULL REFERENCES public.corporations(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'shareholder',
  capability text NOT NULL DEFAULT 'upload' CHECK (capability IN ('view', 'upload', 'manage')),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  UNIQUE (corporation_id, contact_id)
);
CREATE INDEX IF NOT EXISTS idx_entity_vault_access_contact ON public.entity_vault_access(contact_id) WHERE revoked_at IS NULL;

ALTER TABLE public.entity_vault_access ENABLE ROW LEVEL SECURITY;
-- Service role only: who can open an entity's vault is read and changed through vault-service (which audits each change),
-- never directly from the browser.
CREATE POLICY "Service manage entity vault access" ON public.entity_vault_access
  FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT ALL ON public.entity_vault_access TO service_role;
