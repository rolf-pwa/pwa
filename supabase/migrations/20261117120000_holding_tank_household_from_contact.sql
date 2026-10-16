-- An account added to the Holding Tank with a contact but no household takes the contact's household. Closes a gap that left 31 accounts
-- (from the March bulk onboarding and a July registry import) with no household, so no import path can repeat it.
CREATE OR REPLACE FUNCTION public.holding_tank_default_household()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.household_id IS NULL AND NEW.contact_id IS NOT NULL THEN
    SELECT household_id INTO NEW.household_id FROM public.contacts WHERE id = NEW.contact_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS holding_tank_default_household ON public.holding_tank;
CREATE TRIGGER holding_tank_default_household
  BEFORE INSERT OR UPDATE OF contact_id, household_id ON public.holding_tank
  FOR EACH ROW EXECUTE FUNCTION public.holding_tank_default_household();
