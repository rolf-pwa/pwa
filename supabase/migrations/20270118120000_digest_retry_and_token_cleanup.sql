-- Two things behind about 150 portal tokens a day:
-- 1. A digest email that could not be sent was retried every ten minutes for ever, minting a new one-hour sign-in link each time. Rows now count their attempts
--    (a growing delay between tries, then given up on, with a notice to the advisor), and the digest reuses a link that is still good.
-- 2. Nothing ever removed expired tokens. They are purged now, and weekly.
ALTER TABLE public.email_digest_queue ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0;
ALTER TABLE public.email_digest_queue ADD COLUMN IF NOT EXISTS last_attempt_at timestamptz;
ALTER TABLE public.email_digest_queue ADD COLUMN IF NOT EXISTS failed_at timestamptz;

-- Updates that have been stuck for more than a week get one last try (the next run), then are given up on and reported.
UPDATE public.email_digest_queue SET attempts = 5, last_attempt_at = now() - interval '1 day' WHERE sent_at IS NULL AND failed_at IS NULL AND created_at < now() - interval '7 days';

CREATE OR REPLACE FUNCTION public.purge_expired_portal_tokens() RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n bigint;
BEGIN
  DELETE FROM public.portal_tokens WHERE expires_at < now() - interval '30 days';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.purge_expired_portal_tokens() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_expired_portal_tokens() TO service_role;

SELECT public.purge_expired_portal_tokens();
SELECT cron.schedule('portal-token-cleanup', '15 10 * * 0', $$select public.purge_expired_portal_tokens();$$);
