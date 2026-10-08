-- Rental properties: a household's income properties, with their own value, owners (a % each), mortgage link, and annual
-- income and expenses by category. A property's value is kept in step with a real-estate Storehouse row (Legacy Trust),
-- so every document that already counts real estate keeps working and nothing is counted twice.
CREATE TABLE IF NOT EXISTS public.rental_properties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  created_by uuid REFERENCES auth.users(id),
  name text NOT NULL,
  address text,
  city text,
  province text,
  postal_code text,
  purchase_price numeric,
  purchase_date date,
  current_value numeric,
  value_as_of date,
  storehouse_id uuid REFERENCES public.storehouses(id) ON DELETE SET NULL,
  mortgage_liability_id uuid REFERENCES public.liabilities(id) ON DELETE SET NULL,
  net_income_use text NOT NULL DEFAULT 'household' CHECK (net_income_use IN ('household', 'debt_paydown')),
  paydown_liability_id uuid REFERENCES public.liabilities(id) ON DELETE SET NULL,
  notes text
);
CREATE INDEX IF NOT EXISTS idx_rental_properties_household ON public.rental_properties (household_id);

CREATE TABLE IF NOT EXISTS public.rental_property_owners (
  property_id uuid NOT NULL REFERENCES public.rental_properties(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  ownership_pct numeric NOT NULL DEFAULT 100 CHECK (ownership_pct > 0 AND ownership_pct <= 100),
  PRIMARY KEY (property_id, contact_id)
);

CREATE TABLE IF NOT EXISTS public.rental_property_years (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  property_id uuid NOT NULL REFERENCES public.rental_properties(id) ON DELETE CASCADE,
  tax_year integer NOT NULL,
  rent_collected numeric NOT NULL DEFAULT 0,
  property_tax numeric NOT NULL DEFAULT 0,
  insurance numeric NOT NULL DEFAULT 0,
  repairs_maintenance numeric NOT NULL DEFAULT 0,
  management_fees numeric NOT NULL DEFAULT 0,
  utilities numeric NOT NULL DEFAULT 0,
  mortgage_interest numeric NOT NULL DEFAULT 0,
  other_expenses numeric NOT NULL DEFAULT 0,
  notes text,
  UNIQUE (property_id, tax_year)
);

ALTER TABLE public.rental_properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rental_property_owners ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rental_property_years ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Advisors can view rental properties" ON public.rental_properties FOR SELECT TO authenticated USING (true);
CREATE POLICY "Advisors can insert rental properties" ON public.rental_properties FOR INSERT TO authenticated WITH CHECK (auth.uid() = created_by);
CREATE POLICY "Advisors can update rental properties" ON public.rental_properties FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Advisors can delete rental properties" ON public.rental_properties FOR DELETE TO authenticated USING (true);
CREATE POLICY "Advisors can manage property owners" ON public.rental_property_owners FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Advisors can manage property years" ON public.rental_property_years FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Service manages rental properties" ON public.rental_properties FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service manages property owners" ON public.rental_property_owners FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service manages property years" ON public.rental_property_years FOR ALL TO service_role USING (true) WITH CHECK (true);
-- Default privileges also hand out TRUNCATE to the app roles, which RLS does not stop.
REVOKE ALL ON public.rental_properties, public.rental_property_owners, public.rental_property_years FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rental_properties, public.rental_property_owners, public.rental_property_years TO authenticated;
GRANT ALL ON public.rental_properties, public.rental_property_owners, public.rental_property_years TO service_role;
