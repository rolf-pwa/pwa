# V2 desktop release — deployment runbook

Branch: `release/v2-desktop` (staff/desktop only). The client mobile pieces (Web Push, PWA, camera scanner),
Action Brain logging, the training export and the cron schedules are **not** in this release; they live on
`feature/v2-mobile-and-training`.

**Production project:** `rpxevcovasrgmrzkpknu`. This repo's `supabase/.temp/project-ref` is linked to it, so the CLI
commands below hit production. Always pass `--project-ref rpxevcovasrgmrzkpknu` explicitly anyway.

## What ships

| Layer | Change | Existing behaviour affected? |
|---|---|---|
| Database | `households.v2_ai_engine_enabled` (boolean, default false); new tables `system_health_logs`, `stage2_verification_audit`, `golden_dataset_overrides` | No. New objects; one new column defaulting to false. |
| New functions | `stage2-verify`, `stage2-review`, `sentinel-sre-agent` | No. Nothing calls them until V2 is on; the Sentinel has no schedule. |
| **Existing function** | `vault-statement-scan` (flag-gated V2 path) | **Yes, the only one.** V1 path verified identical (see below). |
| Frontend | Glass-Box Review page (`/glass-box-review`) + sidebar link; `pdfjs-dist` (lazy-loaded) | One new menu item; page is empty unless a household has V2 on. |

## Pre-flight (do all before touching production)

1. `git fetch origin` and confirm `main` hasn't moved under the branch: `git log --oneline release/v2-desktop..origin/main` should be empty (if not, rebase and re-run everything below).
2. **`drop_asana` must be on `main` first.** Production already has migration `20261003180000` (it drops the unused Asana columns); it lives in one commit on `origin/drop-asana-columns` (`852c5ee`), which is a fast-forward of `main` and touches only that migration and the regenerated `types.ts`. This branch is already rebased on top of that commit. Before releasing, `origin/main` must contain `852c5ee`. Then confirm (read-only):
   `npx supabase migration list --project-ref rpxevcovasrgmrzkpknu` — expect `REMOTE ONLY` to be empty and the only local-only migrations to be `20261004120000` and `20261004140000` (verified this way on 2026-10-05: 209 in both). If a remote-only entry appears, stop; **do not** use `--include-all` to paper over it.
3. Tests and build: `npx tsc -p tsconfig.app.json --noEmit && npx vitest run && npx vite build` (expect 178 tests passing).
4. **V1 parity harness** (runs the real `vault-statement-scan` handler against fakes, original vs modified):
   `npx deno run --allow-all --node-modules-dir=none scripts/verify/vault-scan-parity.ts` — must print `ALL CHECKS PASSED` (11 checks). It verifies that with the flag off, or if the flag lookup fails, every write, prompt and response is identical to `origin/main`.
   Caveat: it uses fake Drive/Vertex/Supabase, so it proves the logic path, not live integration. Step 4 below is the live check.
5. Pick a **test household** that has a provisioned Vault with a few real investment/insurance PDFs, ideally one that is not an active client. Note its id. Take note of what a normal (V1) scan of it returns today (counts), for comparison in step 4.

## Deployment order (each step is independently reversible)

Order matters: schema first, then functions, then frontend last (merging to `main` auto-deploys the frontend).

### 1. Schema
```
npx supabase db push --dry-run --project-ref rpxevcovasrgmrzkpknu
```
Expect exactly two migrations: `20261004120000_v2_ai_engine_foundation` and `20261004140000_stage2_review_status`. Anything else: stop.
Then `npx supabase db push --project-ref rpxevcovasrgmrzkpknu`. Both `db push` and `migration list` need the production database password (Supabase dashboard → Project Settings → Database); export it as `SUPABASE_DB_PASSWORD` for the session rather than typing it into history. Do it off-hours out of caution: adding the `households` column is metadata-only on Postgres 17 but takes a brief exclusive lock.
Verify (SQL editor):
```sql
select count(*) filter (where v2_ai_engine_enabled) as v2_on, count(*) as households from households;  -- v2_on = 0
select table_name from information_schema.tables where table_schema='public'
 and table_name in ('system_health_logs','stage2_verification_audit','golden_dataset_overrides');   -- 3 rows
```
After this, regenerate `src/integrations/supabase/types.ts` (`supabase gen types`) to replace the hand-written entries, and commit it.

### 2. New functions (inert)
No Docker on this machine, so deploy through the API:
```
for f in stage2-verify stage2-review sentinel-sre-agent; do
  npx supabase functions deploy $f --use-api --project-ref rpxevcovasrgmrzkpknu
done
```
Check: an unauthenticated call returns 401 (`curl -s -o /dev/null -w "%{http_code}" -X POST https://rpxevcovasrgmrzkpknu.supabase.co/functions/v1/stage2-review`).
Do **not** schedule the Sentinel (its cron migration is on the held-back branch) and do not set `SENTINEL_CRON_SECRET` yet.

### 3. `vault-statement-scan` (the only modified production function)
Deploy it alone, right after the schema:
```
npx supabase functions deploy vault-statement-scan --use-api --project-ref rpxevcovasrgmrzkpknu
```
**Live V1 check, immediately:** with the flag still off, run "Scan Vault for Updates" on the test household and compare the counts and the resulting records with what you noted in pre-flight. Watch the function logs for boot errors.
**Rollback (one minute):** `git checkout origin/main -- supabase/functions/vault-statement-scan && npx supabase functions deploy vault-statement-scan --use-api --project-ref rpxevcovasrgmrzkpknu`, then restore the file.

### 4. Frontend
Open the PR and merge to `main`; the Firebase workflow deploys automatically. Then check: sign in, sidebar → Agents → **Glass-Box Review** loads and shows "No pending extractions".
**Rollback:** `git revert -m 1 <merge commit>` and push; hosting redeploys.

### 5. Turn V2 on for the test household only
```sql
update households set v2_ai_engine_enabled = true where id = '<test household id>';
```
Run a scan on it. Expect the response to include `v2HeldForReview: N` and **no** changes to its vineyard/storehouse/holding-tank/insurance rows. Review the held items at `/glass-box-review`: check the checks list, correct a figure, approve, and confirm the live records updated and `golden_dataset_overrides` has the correction.
Look for, and report before enabling anyone else:
- **Truncated or unparseable extractions.** V2 asks for page/box data on every item and output is capped at 8,000 tokens; a large statement may be cut off and show up under `errors` in the scan response. If common, the cap needs raising.
- **Source viewer.** Does the highlighted box land on the right figure on real PDFs? Boxes are best-effort; a wrong or missing box degrades to "no reliable location" but is worth knowing.
- `select * from system_health_logs order by created_at desc limit 20;` — should be empty or explainable.
**Rollback for any household, instant, no deploy:** `update households set v2_ai_engine_enabled = false where id = ...;` Held reviews stay in the table and nothing applied is undone.

## Rollback summary

| Problem | Action |
|---|---|
| V2 misbehaving for a household | Flag off (SQL above). Instant. |
| `vault-statement-scan` regression | Redeploy the `origin/main` version (step 3). |
| Frontend problem | Revert the merge commit; hosting redeploys. |
| Schema | Leave in place. It is additive and unused when the flag is off; no down-migration is needed or provided. |

## Things to be clear-eyed about
- **Causal risk scores use provisional weights** (`supabase/functions/_shared/causal-model-v2.ts`). They are my first-draft judgement, not calibrated. Have an advisor review them before anyone presents a score to a client as more than a relative indicator.
- **No staging environment exists.** The sandbox (`docs/sandbox/README.md`) exercises the schema, new functions and UI end to end, but has no Drive/Vertex credentials, so step 3's live check and step 5's first real scan are the first runs against real integrations.
- ~17 existing edge functions already fail `deno check` (pre-existing); deploys are not type-gated, which is why the parity harness and the live checks above matter.
- The audit and override tables hold full extracted financial data, readable by all staff (the app's existing flat staff-trust model).

## Go / no-go checklist
- [ ] `main` unchanged since the branch was cut (or rebased and re-verified)
- [ ] `origin/main` contains `852c5ee` (drop_asana); `migration list` shows no remote-only entries and only our two new migrations as local-only
- [ ] tsc, 178 tests, build all green
- [ ] Parity harness: `ALL CHECKS PASSED`
- [ ] Test household chosen; baseline V1 scan counts recorded
- [ ] Off-hours window agreed for step 1
- [ ] Someone watching function logs during steps 3 and 5

## Not in this release (see `feature/v2-mobile-and-training`)
Client Web Push / PWA / camera scanner (needs VAPID keys and real icons), Action Brain event logging (includes an edit to `vault-service`),
the training export and PII scrubbing (kill-switched; hold until the privacy policy covers AI training), and the cron schedules for the
Sentinel and push drain (schedule only after their secrets are set).
