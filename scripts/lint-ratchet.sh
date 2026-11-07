#!/usr/bin/env bash
# Lint ratchet: the repo has a large lint backlog, so CI does not require zero errors. It requires that no file this pull request changes
# has MORE eslint errors than it had on the base branch (a new file must have none). Fix a file's errors and the bar for it drops with it.
#   scripts/lint-ratchet.sh origin/main
set -uo pipefail
cd "$(dirname "$0")/.."
base="${1:?base ref required}"
files=$(git diff --name-only --diff-filter=ACMR "$base"...HEAD -- 'src/**/*.ts' 'src/**/*.tsx' 'vite.config.ts' | tr '\n' ' ')
[ -n "${files// /}" ] || { echo "No front-end files changed."; exit 0; }
counts() { # prints "file count" for each given file, reading the checked-out tree
  npx eslint -f json "$@" 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{for(const r of JSON.parse(s||"[]"))console.log(r.filePath.replace(process.cwd()+"/","")+" "+r.errorCount)})'
}
after=$(counts $files)
tmp=$(mktemp -d); git worktree add -q --detach "$tmp" "$(git merge-base "$base" HEAD)"
ln -s "$PWD/node_modules" "$tmp/node_modules"
existing=""; for f in $files; do [ -f "$tmp/$f" ] && existing="$existing $f"; done
before=$(cd "$tmp" && [ -n "$existing" ] && counts $existing)
git worktree remove --force "$tmp"
fail=0
while read -r f n; do
  [ -n "$f" ] || continue
  b=$(echo "$before" | awk -v f="$f" '$1==f{print $2}'); b=${b:-0}
  if [ "$n" -gt "$b" ]; then echo "FAIL  $f: $n lint errors (was $b)"; fail=1; else echo "ok    $f: $n (was $b)"; fi
done <<< "$after"
[ "$fail" = 0 ] && echo "Lint ratchet passed." || echo "Lint ratchet failed: fix the new errors above (npx eslint <file>)."
exit $fail
