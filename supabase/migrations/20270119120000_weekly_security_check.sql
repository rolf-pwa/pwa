-- Weekly security check. Every Monday it looks for the ways the row-security hole of 2026-11 could come back, and tells the advisor in the app if it finds one:
--   1. a row-security policy open to anon / everyone that is not on the known list (the public forms, the active-links and services reads, the "Deny" policies);
--   2. a table in public with row security switched off;
--   3. a signed-in non-staff session opened by something that is not a browser (a script or tool talking straight to the API).
-- It never puts a name or email in the notification. The result of every run is kept in security_audit_logs. The one thing it cannot see is the API request log,
-- which only the Supabase dashboard exposes: scripts/verify/api-access-log.md has the query for that.

CREATE OR REPLACE FUNCTION public.security_weekly_check() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, pg_catalog AS $$
DECLARE
  known text[] := ARRAY[
    'discovery_leads|Anon can create discovery leads', 'georgia_session_starts|Anon can create Georgia session starts',
    'service_bookings|Public can submit booking requests', 'toe_acceptances|Public can record a ToE acceptance',
    'portal_links|Anon can read active portal links', 'services|Public can read active services'];
  open_policies jsonb; no_rls jsonb; scripted jsonb; new_users int; n_open int; n_rls int; n_script int; found boolean; summary text;
BEGIN
  SELECT coalesce(jsonb_agg(p.tablename || ': ' || p.policyname ORDER BY p.tablename, p.policyname), '[]'::jsonb) INTO open_policies
  FROM pg_policies p
  WHERE p.schemaname IN ('public', 'storage') AND p.roles::text <> '{service_role}'
    AND (p.qual = 'true' OR p.with_check = 'true' OR coalesce(p.qual, '') ILIKE '%auth.uid() is%not null%' OR coalesce(p.with_check, '') ILIKE '%auth.uid() is%not null%'
         OR p.roles::text LIKE '%anon%' OR p.roles::text LIKE '%public%')
    AND p.policyname NOT ILIKE 'Deny %'
    -- google_tokens (a user's own rows) and the staff storage policies are limited by their own condition, not by role.
    AND NOT (p.tablename = 'google_tokens' AND (coalesce(p.qual, '') ILIKE '%auth.uid()%' OR coalesce(p.with_check, '') ILIKE '%auth.uid()%'))
    AND NOT (p.schemaname = 'storage' AND p.policyname ILIKE 'Staff %')
    AND (p.tablename || '|' || p.policyname) <> ALL (known);

  SELECT coalesce(jsonb_agg(t.tablename ORDER BY t.tablename), '[]'::jsonb) INTO no_rls
  FROM pg_tables t WHERE t.schemaname = 'public' AND NOT t.rowsecurity;

  -- Sessions of non-staff accounts opened by something that is not a browser. Only the kind of agent is kept, never a name.
  SELECT coalesce(jsonb_agg(DISTINCT coalesce(nullif(left(s.user_agent, 40), ''), '(no user agent)')), '[]'::jsonb) INTO scripted
  FROM auth.sessions s JOIN auth.users u ON u.id = s.user_id
  WHERE lower(coalesce(u.email, '')) NOT LIKE '%@prosperwise.ca'
    AND coalesce(s.created_at, now()) > now() - interval '8 days'
    AND coalesce(s.user_agent, '') NOT ILIKE '%mozilla%';

  SELECT count(*) INTO new_users FROM auth.users u
  WHERE lower(coalesce(u.email, '')) NOT LIKE '%@prosperwise.ca' AND u.created_at > now() - interval '8 days';

  n_open := jsonb_array_length(open_policies); n_rls := jsonb_array_length(no_rls); n_script := jsonb_array_length(scripted);
  found := n_open + n_rls + n_script > 0;
  summary := CASE WHEN found
    THEN format('%s unexpected open policies, %s tables without row security, %s non-browser sign-in kinds. New non-staff accounts this week: %s.', n_open, n_rls, n_script, new_users)
    ELSE format('Nothing unexpected. New non-staff accounts this week: %s.', new_users) END;

  INSERT INTO security_audit_logs (run_id, test_name, status, logic_trace)
  VALUES (gen_random_uuid(), 'weekly_security_check', CASE WHEN found THEN 'fail' ELSE 'pass' END,
          summary || ' ' || jsonb_build_object('open_policies', open_policies, 'tables_without_rls', no_rls, 'non_browser_agents', scripted)::text);

  IF found THEN
    INSERT INTO staff_notifications (title, body, source_type)
    VALUES ('Security check: something needs a look', summary || ' Details are in the latest weekly_security_check row of security_audit_logs.', 'security_weekly');
  END IF;
  RETURN jsonb_build_object('found', found, 'summary', summary, 'open_policies', open_policies, 'tables_without_rls', no_rls, 'non_browser_agents', scripted);
END $$;

REVOKE ALL ON FUNCTION public.security_weekly_check() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.security_weekly_check() TO service_role;

SELECT cron.schedule('security-weekly-check', '0 13 * * 1', $$select public.security_weekly_check();$$);
