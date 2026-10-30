-- Other assets: what a household owns apart from investment accounts (principal residence, vehicles, collectibles...).
-- Each asset belongs to a household and has one or more owners with a % split (individual or joint); the household
-- counts it once, at full value. An optional storehouse_id marks a real-estate Storehouse row this asset replaces:
-- the review counts the asset, not that row, so nothing is counted twice and no Storehouse data is deleted.
CREATE TABLE IF NOT EXISTS public.other_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  created_by uuid REFERENCES auth.users(id),
  category text NOT NULL DEFAULT 'other'
    CHECK (category IN ('principal_residence', 'other_property', 'vehicle', 'boat_rv', 'valuables', 'other')),
  name text NOT NULL,
  description text,
  current_value numeric,
  value_as_of date,
  value_source text,
  acquired_date date,
  purchase_price numeric,
  liability_id uuid REFERENCES public.liabilities(id) ON DELETE SET NULL,
  storehouse_id uuid REFERENCES public.storehouses(id) ON DELETE SET NULL,
  notes text
);
CREATE INDEX IF NOT EXISTS idx_other_assets_household ON public.other_assets (household_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_other_assets_storehouse ON public.other_assets (storehouse_id) WHERE storehouse_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.other_asset_owners (
  asset_id uuid NOT NULL REFERENCES public.other_assets(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  ownership_pct numeric NOT NULL DEFAULT 100 CHECK (ownership_pct > 0 AND ownership_pct <= 100),
  PRIMARY KEY (asset_id, contact_id)
);
CREATE INDEX IF NOT EXISTS idx_other_asset_owners_contact ON public.other_asset_owners (contact_id);

DROP TRIGGER IF EXISTS update_other_assets_updated_at ON public.other_assets;
CREATE TRIGGER update_other_assets_updated_at BEFORE UPDATE ON public.other_assets FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.other_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.other_asset_owners ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Advisors can view other assets" ON public.other_assets FOR SELECT TO authenticated USING (true);
CREATE POLICY "Advisors can insert other assets" ON public.other_assets FOR INSERT TO authenticated WITH CHECK (auth.uid() = created_by);
CREATE POLICY "Advisors can update other assets" ON public.other_assets FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Advisors can delete other assets" ON public.other_assets FOR DELETE TO authenticated USING (true);
CREATE POLICY "Advisors can manage other asset owners" ON public.other_asset_owners FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Service manages other assets" ON public.other_assets FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service manages other asset owners" ON public.other_asset_owners FOR ALL TO service_role USING (true) WITH CHECK (true);
-- Default privileges also hand out TRUNCATE to the app roles, which RLS does not stop.
REVOKE ALL ON public.other_assets, public.other_asset_owners FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.other_assets, public.other_asset_owners TO authenticated;
GRANT ALL ON public.other_assets, public.other_asset_owners TO service_role;

-- Bring existing real-estate Storehouse rows across (rental properties keep their own link and are left alone).
-- Value, owner and household carry over, so the Legacy Trust total does not move. Category starts as principal
-- residence and can be changed on the card.
WITH moved AS (
  INSERT INTO public.other_assets (household_id, category, name, current_value, value_as_of, value_source, storehouse_id)
  SELECT c.household_id, 'principal_residence', COALESCE(NULLIF(trim(s.label), ''), 'Real estate'), s.current_value,
         s.updated_at::date, 'Carried over from the Legacy Trust', s.id
  FROM public.storehouses s
  JOIN public.contacts c ON c.id = s.contact_id
  WHERE s.asset_type = 'Primary Residence & Protected Legacy Accounts'
    AND c.household_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.rental_properties r WHERE r.storehouse_id = s.id)
    AND NOT EXISTS (SELECT 1 FROM public.other_assets a WHERE a.storehouse_id = s.id)
  RETURNING id, storehouse_id
)
INSERT INTO public.other_asset_owners (asset_id, contact_id, ownership_pct)
SELECT m.id, s.contact_id, 100 FROM moved m JOIN public.storehouses s ON s.id = m.storehouse_id;
