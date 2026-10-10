-- Vault audit log: tamper-evident and append-only.
--  * household_id is filled in (it was never written by the app, so per-household queries found nothing)
--  * every row carries seq, prev_hash and row_hash: a SHA-256 chain, so an edit, deletion or insertion
--    anywhere in history is detectable by verify_vault_audit_chain()
--  * UPDATE, DELETE and TRUNCATE are refused (privileges revoked and triggers that raise). Only the database
--    owner could disable the triggers, which is itself a deliberate, visible act.

ALTER TABLE public.vault_audit_log
  ADD COLUMN IF NOT EXISTS seq bigint,
  ADD COLUMN IF NOT EXISTS prev_hash text,
  ADD COLUMN IF NOT EXISTS row_hash text,
  ADD COLUMN IF NOT EXISTS actor_email text;

-- 1. Fill household_id from what the row already points at.
UPDATE public.vault_audit_log l SET household_id = COALESCE(
  (SELECT f.household_id FROM public.vault_files f WHERE f.drive_id = l.drive_id AND f.household_id IS NOT NULL LIMIT 1),
  (SELECT s.household_id FROM public.vault_share_links s WHERE s.drive_id = l.drive_id LIMIT 1),
  (SELECT c.household_id FROM public.contacts c WHERE c.id = l.contact_id),
  CASE WHEN l.metadata->>'household_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN (l.metadata->>'household_id')::uuid END
) WHERE l.household_id IS NULL;

-- 2. The hash of one row, chained to the hash before it.
CREATE OR REPLACE FUNCTION public.vault_audit_row_hash(prev text, r public.vault_audit_log)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT encode(sha256(convert_to(concat_ws('|',
    COALESCE(prev, 'GENESIS'), r.seq, r.id,
    to_char(r.created_at AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    r.actor_type, COALESCE(r.actor_id::text, ''), COALESCE(r.actor_label, ''), COALESCE(r.actor_email, ''),
    r.action, COALESCE(r.drive_id, ''), COALESCE(r.drive_name, ''),
    COALESCE(r.contact_id::text, ''), COALESCE(r.household_id::text, ''),
    COALESCE(r.ip, ''), COALESCE(r.user_agent, ''), COALESCE(r.metadata::text, '{}')
  ), 'UTF8')), 'hex');
$$;

-- 3. Chain the existing rows in time order.
DO $$
DECLARE r public.vault_audit_log%ROWTYPE; prev text := NULL; n bigint := 0; h text;
BEGIN
  FOR r IN SELECT * FROM public.vault_audit_log ORDER BY created_at, id LOOP
    n := n + 1;
    r.seq := n; r.prev_hash := prev;
    h := public.vault_audit_row_hash(prev, r);
    UPDATE public.vault_audit_log SET seq = n, prev_hash = prev, row_hash = h WHERE id = r.id;
    prev := h;
  END LOOP;
END $$;

ALTER TABLE public.vault_audit_log ALTER COLUMN seq SET NOT NULL, ALTER COLUMN row_hash SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS vault_audit_log_seq_key ON public.vault_audit_log (seq);
CREATE INDEX IF NOT EXISTS idx_vault_audit_household_time ON public.vault_audit_log (household_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vault_audit_drive ON public.vault_audit_log (drive_id);
CREATE INDEX IF NOT EXISTS idx_vault_audit_created ON public.vault_audit_log (created_at DESC);

-- 4. New rows join the chain. One writer at a time, so seq has no gaps and prev_hash is always the latest row.
CREATE OR REPLACE FUNCTION public.vault_audit_chain_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE last_seq bigint; last_hash text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('vault_audit_chain'));
  SELECT seq, row_hash INTO last_seq, last_hash FROM public.vault_audit_log ORDER BY seq DESC LIMIT 1;
  NEW.seq := COALESCE(last_seq, 0) + 1;
  NEW.prev_hash := last_hash;
  NEW.row_hash := public.vault_audit_row_hash(last_hash, NEW);
  RETURN NEW;
END $$;
CREATE TRIGGER vault_audit_chain_insert BEFORE INSERT ON public.vault_audit_log
  FOR EACH ROW EXECUTE FUNCTION public.vault_audit_chain_insert();

-- 5. Append-only.
CREATE OR REPLACE FUNCTION public.vault_audit_refuse_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'vault_audit_log is append-only: % is not allowed', TG_OP USING ERRCODE = 'insufficient_privilege';
END $$;
CREATE TRIGGER vault_audit_no_update_delete BEFORE UPDATE OR DELETE ON public.vault_audit_log
  FOR EACH ROW EXECUTE FUNCTION public.vault_audit_refuse_change();
CREATE TRIGGER vault_audit_no_truncate BEFORE TRUNCATE ON public.vault_audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION public.vault_audit_refuse_change();
REVOKE UPDATE, DELETE, TRUNCATE ON public.vault_audit_log FROM PUBLIC, anon, authenticated, service_role;

-- 6. Integrity check: recompute the whole chain.
CREATE OR REPLACE FUNCTION public.verify_vault_audit_chain()
RETURNS TABLE (ok boolean, rows_checked bigint, first_bad_seq bigint, detail text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.vault_audit_log%ROWTYPE; prev text := NULL; expected bigint := 0; n bigint := 0;
BEGIN
  FOR r IN SELECT * FROM public.vault_audit_log ORDER BY seq LOOP
    expected := expected + 1; n := n + 1;
    IF r.seq <> expected THEN
      RETURN QUERY SELECT false, n, r.seq, format('sequence gap: expected %s, found %s (a row is missing)', expected, r.seq); RETURN;
    END IF;
    IF r.prev_hash IS DISTINCT FROM prev THEN
      RETURN QUERY SELECT false, n, r.seq, 'previous-hash link does not match'; RETURN;
    END IF;
    IF r.row_hash <> public.vault_audit_row_hash(prev, r) THEN
      RETURN QUERY SELECT false, n, r.seq, 'row contents do not match their hash (the row was altered)'; RETURN;
    END IF;
    prev := r.row_hash;
  END LOOP;
  RETURN QUERY SELECT true, n, NULL::bigint, 'chain intact'::text;
END $$;
REVOKE ALL ON FUNCTION public.verify_vault_audit_chain() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.verify_vault_audit_chain() TO authenticated, service_role;
