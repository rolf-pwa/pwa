-- Veem as a second invoicing platform beside Square. An invoice is routed by its payment_method ('veem' = a Veem invoice);
-- the Veem invoice id is kept here, the claim link goes in public_payment_url, and the payer details Veem requires are
-- kept per client in veem_payer_details (never the payer's bank details).
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS veem_invoice_id text;
CREATE INDEX IF NOT EXISTS idx_invoices_veem_invoice_id ON public.invoices (veem_invoice_id) WHERE veem_invoice_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.veem_payer_details (
  contact_id uuid PRIMARY KEY REFERENCES public.contacts(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  payer_type text NOT NULL DEFAULT 'Personal' CHECK (payer_type IN ('Personal', 'Business')),
  first_name text,
  last_name text,
  phone text,
  phone_country_code text,         -- includes the '+', e.g. +1
  country_code text,               -- ISO 3166 alpha-2
  business_name text,
  industry text,
  sub_industry text,
  entity text,                     -- e.g. Corporation, Sole Proprietorship
  tax_id_number text,
  street text,
  city text,
  province text,
  postal_code text,
  address_country_code text
);
ALTER TABLE public.veem_payer_details ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Advisors can manage veem payer details" ON public.veem_payer_details FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Service manages veem payer details" ON public.veem_payer_details FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.veem_payer_details FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.veem_payer_details TO authenticated;
GRANT ALL ON public.veem_payer_details TO service_role;
