-- Once a household has finished onboarding its invitation link is no longer needed: revoke any that is still live, however onboarding was completed.
CREATE OR REPLACE FUNCTION public.revoke_invites_on_onboarding_complete() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.onboarding_completed_at IS NOT NULL AND (OLD.onboarding_completed_at IS NULL) THEN
    UPDATE public.onboarding_invites SET revoked_at = now() WHERE household_id = NEW.id AND revoked_at IS NULL;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_revoke_invites_on_onboarding_complete ON public.households;
CREATE TRIGGER trg_revoke_invites_on_onboarding_complete AFTER UPDATE OF onboarding_completed_at ON public.households
  FOR EACH ROW EXECUTE FUNCTION public.revoke_invites_on_onboarding_complete();
-- Households that finished before this existed: revoke their stale links too.
UPDATE public.onboarding_invites i SET revoked_at = now() FROM public.households h WHERE h.id = i.household_id AND h.onboarding_completed_at IS NOT NULL AND i.revoked_at IS NULL;
