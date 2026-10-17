#!/usr/bin/env bash
# Type-checks Supabase edge functions with deno (nothing else in CI does: tsc and vite never read supabase/functions).
#   scripts/deno-check-functions.sh            check every function not in the baseline
#   scripts/deno-check-functions.sh <base-ref> check only functions changed since <base-ref> (all of them if a _shared file changed)
# supabase/functions/.deno-check-baseline lists functions that already have type errors: they are skipped until fixed (delete the line).
set -uo pipefail
cd "$(dirname "$0")/.."
BASELINE=supabase/functions/.deno-check-baseline
base_ref="${1:-}"
fns=()
if [ -n "$base_ref" ]; then
  changed=$(git diff --name-only "$base_ref"...HEAD -- supabase/functions)
  if echo "$changed" | grep -q '^supabase/functions/_shared/'; then
    for d in supabase/functions/*/; do fns+=("$(basename "$d")"); done
  else
    while IFS= read -r f; do n=$(echo "$f" | cut -d/ -f3); [ -n "$n" ] && fns+=("$n"); done < <(echo "$changed" | grep -v '^supabase/functions/_')
  fi
else
  for d in supabase/functions/*/; do fns+=("$(basename "$d")"); done
fi
[ "${#fns[@]}" -gt 0 ] || { echo "No edge functions changed."; exit 0; }
failed=0; checked=0
for n in $(printf '%s\n' "${fns[@]}" | sort -u); do
  [ -f "supabase/functions/$n/index.ts" ] || continue
  case "$n" in _*) continue;; esac
  if grep -qx "$n" "$BASELINE" 2>/dev/null; then echo "skip  $n (in baseline)"; continue; fi
  checked=$((checked+1))
  if out=$(deno check "supabase/functions/$n/index.ts" 2>&1); then echo "ok    $n"; else echo "FAIL  $n"; echo "$out" | grep -E "ERROR" -A4 | head -12; failed=$((failed+1)); fi
done
echo "checked $checked, failed $failed"
[ "$failed" -eq 0 ]
