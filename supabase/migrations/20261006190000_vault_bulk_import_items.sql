-- Bulk statement import: one row per statement the importer filed into a household Vault. Files are
-- filed hidden from clients (vault_files.client_visible = false) and revealed per batch after review.
CREATE TABLE IF NOT EXISTS public.vault_bulk_import_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  batch_id uuid NOT NULL,
  household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  contract_number text NOT NULL,
  statement_date date NOT NULL,
  drive_id text NOT NULL UNIQUE,
  file_name text NOT NULL,
  filed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  revealed_at timestamptz,
  revealed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_vault_bulk_import_items_batch ON public.vault_bulk_import_items (batch_id);
-- A given contract + statement date is filed at most once, so re-running an import is harmless.
CREATE UNIQUE INDEX IF NOT EXISTS uq_vault_bulk_import_items_contract_date
  ON public.vault_bulk_import_items (contract_number, statement_date);

-- Staff read only; the default privileges also hand out write/TRUNCATE (which RLS does not stop), so revoke them.
REVOKE ALL ON public.vault_bulk_import_items FROM anon, authenticated;
GRANT SELECT ON public.vault_bulk_import_items TO authenticated;
GRANT ALL ON public.vault_bulk_import_items TO service_role;
ALTER TABLE public.vault_bulk_import_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff view bulk import items" ON public.vault_bulk_import_items
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Service manages bulk import items" ON public.vault_bulk_import_items
  FOR ALL TO service_role USING (true) WITH CHECK (true);
