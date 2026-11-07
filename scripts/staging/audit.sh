#!/usr/bin/env bash
# Runs the weekly security check (public.security_weekly_check) against staging and fails if it finds anything: a policy open to everyone that is
# not on the known list, or a table without row security. Run after scripts/staging/build.sh.
set -uo pipefail
cd "$(dirname "$0")/../.."
REF="${STAGING_REF:-hxlfdwpjbthrnbusnlgq}"
[ "$REF" != "rpxevcovasrgmrzkpknu" ] || { echo "Refusing: that is the production project."; exit 1; }
out=$(npx --yes supabase@3.0.0 db query --remote="$REF" --yes --output-format json "select public.security_weekly_check() as r" 2>&1)
echo "$out" | grep -E '"found"|"summary"|"open_policies"|"tables_without_rls"|"non_browser_agents"' | head -8
if echo "$out" | grep -Eq '"found": *false'; then echo "Audit passed."; else echo "Audit FAILED (or could not run). See the lines above and scripts/verify/open-policies.sql."; exit 1; fi
