-- veem_payer_details and invoices.veem_invoice_id exist in production but no earlier migration creates it (it was made outside the migration files), so a database built from the
-- migrations alone failed (the invoices column is the same kind of gap) at 20270117120000. This creates it only if it is missing, matching production: a no-op in production, the real thing on a fresh
-- build (staging, a restore test). Its policies are set by 20270117120000_staff_only_row_security.

CREATE TABLE IF NOT EXISTS public.veem_payer_details (
  contact_id uuid PRIMARY KEY REFERENCES public.contacts(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  payer_type text NOT NULL DEFAULT 'Personal' CHECK (payer_type IN ('Personal', 'Business')),
  first_name text, last_name text, phone text, phone_country_code text, country_code text,
  business_name text, industry text, sub_industry text, entity text, tax_id_number text,
  street text, city text, province text, postal_code text, address_country_code text
);
ALTER TABLE public.veem_payer_details ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.veem_payer_details TO authenticated;
GRANT ALL ON public.veem_payer_details TO service_role;

-- production also has the Veem invoice id on invoices, with a partial index; no migration adds either.
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS veem_invoice_id text;
CREATE INDEX IF NOT EXISTS idx_invoices_veem_invoice_id ON public.invoices USING btree (veem_invoice_id) WHERE (veem_invoice_id IS NOT NULL);
