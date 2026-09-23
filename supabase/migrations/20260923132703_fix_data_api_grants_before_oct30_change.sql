-- Supabase is removing its automatic Data API grant on new `public` tables
-- starting October 30, 2026 (see their notice email, subject "Data API
-- access changes for new tables"). Today, every CREATE TABLE in `public`
-- gets an implicit grant to anon/authenticated/service_role behind the
-- scenes -- confirmed live: all ~100 tables in this project currently have
-- it despite only ~14 of the ~61 CREATE TABLE migrations in this repo ever
-- issuing an explicit GRANT themselves. After Oct 30 that implicit step
-- disappears for anything CREATEd from that date on -- not just genuinely
-- new tables going forward, but also every existing table's CREATE TABLE
-- statement if this schema is ever replayed from scratch (a local
-- `supabase db reset`, a preview branch, or standing up a fresh project --
-- this project has already done exactly that once this session, migrating
-- off the old Lovable Cloud Supabase project). A post-Oct-30 replay would
-- silently leave ~47 of this project's tables with zero Data API access.
--
-- Two-part fix:
--   1. Explicitly (re-)grant every table that already exists today, so a
--      future full replay of migration history up to this point still ends
--      up with the same access it has right now, regardless of whether
--      Supabase's implicit step still exists by the time that replay runs.
--   2. ALTER DEFAULT PRIVILEGES for the `postgres` role (the owner of every
--      table in this schema, and the role `supabase db push` runs
--      migrations as) so every table CREATEd by a *future* migration gets
--      these grants automatically too -- closing the same gap for tables
--      not yet written, without relying on every future migration
--      remembering to add its own GRANT block (proven unreliable already:
--      3 CREATE TABLE migrations earlier this same session shipped without
--      one -- add_adobe_webforms, add_toe_acceptances, add_liabilities).
--
-- Deliberately NOT granting `anon` here (existing tables keep whatever
-- anon access they already have from Supabase's old implicit default, but
-- this migration doesn't re-establish it going forward) -- matches this
-- project's own established, more recent convention of granting only
-- `authenticated`/`service_role` explicitly and keeping client-facing
-- access behind service-role edge functions rather than raw anon/RLS
-- access, which this codebase has been deliberately moving toward all
-- session (see the compliance-audit work closing an earlier overly-broad
-- anon RLS policy). No sequences/functions touched -- this schema uses
-- gen_random_uuid() PKs throughout, not serial columns, and the email is
-- specifically about table-level Data API access, not RPC.

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL ON TABLES TO service_role;
