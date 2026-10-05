# V2 sandbox

A throwaway Supabase project (`jefuguzlmnrdcuqpiuar`, ca-central-1, free plan) for clicking through the
V2 features without touching production. Credentials live in the git-ignored `sandbox.secrets.local`.

## Run the app against it
`.env.sandbox.local` (git-ignored) holds the sandbox URL/anon key. Start the frontend in sandbox mode:

    npm run dev -- --mode sandbox --port 8081

Staff login is Google-only, so sign in by injecting a session for the seeded test user
(`sandbox.staff@prosperwise.ca`; the edge functions require an `@prosperwise.ca` email):
get tokens from `POST <SANDBOX_URL>/auth/v1/token?grant_type=password`, then in the browser console set
`localStorage['sb-jefuguzlmnrdcuqpiuar-auth-token']` to the session JSON and open `/glass-box-review`.

## How the sandbox was built (and why it differs from the repo)
Work from a **copy** of `supabase/` so the repo stays linked to production. In the copy only:
1. Replace the production project ref with the sandbox ref in `config.toml` and the 9 cron migrations
   (otherwise sandbox cron jobs would call production functions).
2. In migration `20260507181348_*`, remove the `realtime.messages` policy block (needs owner rights a fresh hosted project doesn't grant).
3. `supabase link --project-ref <sandbox>` then `supabase db push`; afterwards `select cron.unschedule(jobid) from cron.job`.
4. Add `http://localhost:8081` to `ALLOWED_ORIGINS` in the functions you deploy (they only allow production origins), then
   `supabase functions deploy <name> --use-api --project-ref <sandbox>`.
   Deployed: stage2-review, stage2-verify, portal-pwa, training-export, sentinel-sre-agent.
5. Seed: `deno run --allow-all --node-modules-dir=none scripts/sandbox/seed.ts` with `SANDBOX_URL` / `SANDBOX_SERVICE_ROLE_KEY` set.

## Not available in the sandbox
No Google Drive / Vertex / Square / Quo credentials, so: the source-document viewer ("No source file is linked"),
Vault scans, payments and SMS don't work. Web Push needs VAPID keys (unset) and a real device. The header's
`quo-service` poll logs a CORS error because that function isn't deployed. Training export stays off
(`AI_TRAINING_EXPORT_ENABLED` unset), as it must until the privacy policy covers it.
