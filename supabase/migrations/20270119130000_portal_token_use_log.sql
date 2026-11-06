-- A record of every attempt to use a portal link or session token (see supabase/functions/_shared/portal-token-log.ts). Staff-only to read; the portal
-- writes it with the service role. Kept 400 days by the weekly token cleanup.

CREATE TABLE IF NOT EXISTS public.portal_token_uses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  token_id uuid,
  contact_id uuid,
  purpose text,
  outcome text NOT NULL CHECK (outcome IN ('ok', 'first_use', 'invalid', 'expired', 'already_used')),
  ip text,
  user_agent text,
  token_fingerprint text
);
GRANT SELECT ON public.portal_token_uses TO authenticated;
GRANT ALL ON public.portal_token_uses TO service_role;
ALTER TABLE public.portal_token_uses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff can read portal token uses" ON public.portal_token_uses FOR SELECT TO authenticated USING (public.is_staff());
CREATE INDEX IF NOT EXISTS portal_token_uses_token_idx ON public.portal_token_uses (token_id, created_at DESC);
CREATE INDEX IF NOT EXISTS portal_token_uses_created_idx ON public.portal_token_uses (created_at DESC);

-- The first use of a sign-in link also keeps the browser, beside the address it already kept.
ALTER TABLE public.portal_tokens ADD COLUMN IF NOT EXISTS first_used_user_agent text;

CREATE OR REPLACE FUNCTION public.purge_expired_portal_tokens() RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n bigint;
BEGIN
  DELETE FROM public.portal_tokens WHERE expires_at < now() - interval '30 days';
  GET DIAGNOSTICS n = ROW_COUNT;
  DELETE FROM public.portal_token_uses WHERE created_at < now() - interval '400 days';
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.purge_expired_portal_tokens() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_expired_portal_tokens() TO service_role;
