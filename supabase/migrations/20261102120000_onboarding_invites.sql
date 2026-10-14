-- Onboarding invitation links. For a household Rolf invites personally (a new household in a VFO family, say): a unique link for the
-- head of household. When they click it, the click starts Georgia's onboarding at once (the same Sovereignty Survey onboarding a paid
-- client gets) and sends them on to the website. The link carries only a random token; Georgia's email goes to the address on file.
-- Service role only: managed by staff through onboarding-agent-admin, used through intake-portal.
CREATE TABLE IF NOT EXISTS public.onboarding_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  first_clicked_at timestamptz,
  last_clicked_at timestamptz,
  click_count int NOT NULL DEFAULT 0,
  started_at timestamptz,
  welcome_sent_to int NOT NULL DEFAULT 0,
  revoked_at timestamptz,
  unclicked_task_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_onboarding_invites_household ON public.onboarding_invites (household_id, created_at DESC);
ALTER TABLE public.onboarding_invites ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service manage onboarding invites" ON public.onboarding_invites FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT ALL ON public.onboarding_invites TO service_role;
