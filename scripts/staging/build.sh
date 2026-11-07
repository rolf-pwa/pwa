#!/usr/bin/env bash
# Rebuilds the staging project's database from this repo's migrations. Staging holds NO real client data, only what the seed script creates.
#   scripts/staging/build.sh            apply every migration to staging, then switch all scheduled jobs off
#   RESET=1 scripts/staging/build.sh    first drop and recreate the public schema (wipes staging)
# Safety rules built in: it refuses to run against production; production's project ref inside migrations (cron job URLs) is rewritten to staging's;
# and every cron job is unscheduled at the end, so staging never calls anything on its own (and never calls production).
set -uo pipefail
cd "$(dirname "$0")/../.."
STAGING=hxlfdwpjbthrnbusnlgq
PROD=rpxevcovasrgmrzkpknu
REF="${STAGING_REF:-$STAGING}"
[ "$REF" != "$PROD" ] || { echo "Refusing: that is the production project."; exit 1; }
SB="npx --yes supabase@3.0.0"
q() { $SB db query --remote="$REF" --yes "$@"; }

echo "Target: $REF"
q "create extension if not exists pg_cron; create extension if not exists pg_net with schema extensions; create extension if not exists vector with schema extensions;" >/dev/null || { echo "extensions failed"; exit 1; }
# A fresh project has no migration history table yet; the CLI would create it, but this script applies files itself.
q "create schema if not exists supabase_migrations; create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text);" >/dev/null || exit 1

if [ "${RESET:-0}" = 1 ]; then
  # Wipe everything the migrations create outside public too, so a rerun starts from a blank project: scheduled jobs, storage policies and buckets,
  # triggers on auth.users, tables in the realtime publication, and the migration history.
  q "select cron.unschedule(jobid) from cron.job;
     do \$\$ declare r record; begin
       for r in select policyname, tablename from pg_policies where schemaname = 'storage' loop execute format('drop policy %I on storage.%I', r.policyname, r.tablename); end loop;
       for r in select t.tgname from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'auth' and c.relname = 'users' and not t.tgisinternal loop execute format('drop trigger %I on auth.users', r.tgname); end loop;
       for r in select schemaname, tablename from pg_publication_tables where pubname = 'supabase_realtime' loop execute format('alter publication supabase_realtime drop table %I.%I', r.schemaname, r.tablename); end loop;
     end \$\$;
     set storage.allow_delete_query = 'true'; delete from storage.objects; delete from storage.buckets;
     drop schema public cascade; create schema public; grant usage on schema public to postgres, anon, authenticated, service_role; grant all on schema public to postgres, service_role;
     alter default privileges in schema public grant all on tables to postgres, service_role; alter default privileges in schema public grant all on functions to postgres, service_role; alter default privileges in schema public grant all on sequences to postgres, service_role;
     delete from supabase_migrations.schema_migrations;" >/dev/null || { echo "reset failed"; exit 1; }
fi

# The reset above drops the public schema, and production's pgcrypto lives in public (see the end of this script), so a second reset removes it.
# Put the extensions back, in the extensions schema, before any migration runs.
q "create extension if not exists pgcrypto with schema extensions; create extension if not exists \"uuid-ossp\" with schema extensions;" >/dev/null || { echo "extensions failed"; exit 1; }

fail=0; applied=0; tmp=$(mktemp)
for f in $(ls supabase/migrations/*.sql | sort); do
  case "$f" in *" 2.sql") continue;; esac   # accidental duplicate copies of a migration
  # A hosted project does not let us change the realtime schema's tables (needs an owner role we do not have), so migrations that only do that are skipped here.
  if grep -q "realtime\.messages" "$f"; then echo "skip  $(basename "$f") (realtime.messages needs an owner role)"; continue; fi
  base=$(basename "$f" .sql); version=${base%%_*}; name=${base#*_}
  sed "s/$PROD/$REF/g" "$f" > "$tmp"
  printf '\n;\ninsert into supabase_migrations.schema_migrations (version, name, statements) values (%s, %s, %s) on conflict do nothing;\n' "'$version'" "'${name//\'/\'\'}'" "'{}'" >> "$tmp"
  if out=$(q -f "$tmp" 2>&1); then applied=$((applied+1)); else fail=$((fail+1)); echo "FAIL  $base"; echo "$out" | grep -iE "error|message" | head -3; fi
done
rm -f "$tmp"
# Production has pgcrypto in the public schema; match it so unqualified calls to crypt/digest/gen_salt behave the same.
q "alter extension pgcrypto set schema public" >/dev/null 2>&1
q "select cron.unschedule(jobid) from cron.job" >/dev/null 2>&1
echo "Applied $applied, failed $fail. Scheduled jobs switched off."
[ "$fail" = 0 ]
