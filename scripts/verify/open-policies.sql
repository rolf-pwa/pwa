-- Row security audit: lists every policy that lets someone other than staff in. Run it read-only after any migration that touches policies, for example:
--   npx supabase db query --linked --read-only -f scripts/verify/open-policies.sql
-- Expected today: only the public forms that INSERT (discovery_leads, service_bookings, toe_acceptances, georgia_session_starts), the active-links and
-- active-services reads, and the "Deny" policies (false). Anything else listed is a hole.
select schemaname, tablename, policyname, cmd, roles::text as roles, qual, with_check
from pg_policies
where schemaname in ('public', 'storage')
  and roles::text <> '{service_role}'
  and (
    qual = 'true' or with_check = 'true'
    or coalesce(qual, '') ilike '%auth.uid() is not null%' or coalesce(with_check, '') ilike '%auth.uid() is not null%'
    or roles::text like '%anon%' or roles::text like '%public%'
  )
order by tablename, policyname;
