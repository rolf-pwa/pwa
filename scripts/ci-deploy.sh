#!/usr/bin/env bash
# Deploys what a merge to main changed to the production Supabase project: new migrations first, then changed edge functions.
#   scripts/ci-deploy.sh <before-sha> <after-sha>      DRY_RUN=1 prints the plan and changes nothing
#   FUNCTIONS="a b" scripts/ci-deploy.sh               redeploy the named functions only (manual recovery)
#   MIGRATIONS="supabase/migrations/x.sql" scripts/ci-deploy.sh   apply the named migration files (manual recovery, e.g. after a failed run)
# Needs SUPABASE_ACCESS_TOKEN in the environment (the GitHub secret). Migrations are chosen by "added in this push", not by comparing the
# migration history, because that history has known drift (two files share a version in three places, and one remote version has no file).
set -uo pipefail
cd "$(dirname "$0")/.."
REF=rpxevcovasrgmrzkpknu
SB="npx --yes supabase@3.0.0"
before="${1:-}"; after="${2:-HEAD}"
dry="${DRY_RUN:-0}"
run() { if [ "$dry" = 1 ]; then echo "DRY   $*"; else "$@"; fi; }

migrations=(); fns=()
if [ -n "${FUNCTIONS:-}" ] || [ -n "${MIGRATIONS:-}" ]; then
  [ -z "${FUNCTIONS:-}" ] || read -ra fns <<< "$FUNCTIONS"
  [ -z "${MIGRATIONS:-}" ] || read -ra migrations <<< "$MIGRATIONS"
else
  [ -n "$before" ] || { echo "usage: $0 <before> <after>"; exit 2; }
  # An all-zero "before" is a brand new branch: nothing to compare, deploy nothing.
  case "$before" in 0000000*) echo "No previous commit to compare; nothing to deploy."; exit 0;; esac
  while IFS= read -r f; do [ -n "$f" ] && migrations+=("$f"); done < <(git diff --name-only --diff-filter=A "$before" "$after" -- 'supabase/migrations/*.sql' | sort)

  while IFS= read -r n; do [ -n "$n" ] && fns+=("$n"); done < <(python3 scripts/ci-changed-functions.py "$before" "$after")
fi

echo "Migrations to apply: ${#migrations[@]}"; [ "${#migrations[@]}" -gt 0 ] && printf '  %s\n' "${migrations[@]}"
echo "Functions to deploy: ${#fns[@]}"; [ "${#fns[@]}" -gt 0 ] && printf '  %s\n' "${fns[@]}"

for f in ${migrations[@]+"${migrations[@]}"}; do
  base=$(basename "$f" .sql); version=${base%%_*}; name=${base#*_}
  case "$version" in [0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]) ;; *) echo "FAIL  $f: name must start with a 14-digit version"; exit 1;; esac
  if [ "$dry" = 1 ]; then echo "DRY   apply $f as version $version"; continue; fi
  # JSON output on purpose: without a terminal the CLI prints a text table, not JSON, unless asked.
  exists=$($SB db query --remote=$REF --read-only --output-format json "select count(*) as n from supabase_migrations.schema_migrations where version='$version'" 2>&1)
  if echo "$exists" | grep -Eq '"n": *0\b|│ *0 *│'; then :; else echo "FAIL  version $version is already recorded in production (or the check failed); not applying $f"; echo "$exists" | tail -5; exit 1; fi
  # One file, one transaction: the migration and its history row succeed or fail together.
  tmp=$(mktemp); { cat "$f"; printf '\n;\ninsert into supabase_migrations.schema_migrations (version, name, statements) values (%s, %s, %s) on conflict do nothing;\n' "'$version'" "'${name//\'/\'\'}'" "'{}'"; } > "$tmp"
  if $SB db query --remote=$REF --yes -f "$tmp"; then echo "ok    migration $version"; rm -f "$tmp"; else echo "FAIL  migration $f (rolled back). Nothing after it was applied or deployed."; rm -f "$tmp"; exit 1; fi
done

if [ "${#fns[@]}" -gt 0 ]; then
  # One command for all of them, four at a time. Edge functions bundle their shared files, so a change to a _shared file redeploys every function that uses it.
  if run $SB functions deploy "${fns[@]}" --project-ref $REF --use-api --jobs 4 --yes; then echo "ok    ${#fns[@]} function(s) deployed"; else echo "FAIL  function deploy"; exit 1; fi
fi
echo "Deploy complete."
