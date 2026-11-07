# Staging project

`prosperwise-staging` (`hxlfdwpjbthrnbusnlgq`, ca-central-1, free plan). A copy of production's **structure** with **no client data**, for testing migrations and functions before they reach production. It replaces the old V2 sandbox (deleted 2026-11).

## Rebuild it
    RESET=1 scripts/staging/build.sh     # wipes staging, applies every migration, switches all scheduled jobs off (about 5 minutes)

Needs the Supabase CLI logged in as the account owner. The script refuses to run against production.

## Rules
- Never copy production data into it. Seed data is synthetic only.
- Scheduled jobs stay off: production's project ref inside migrations is rewritten to staging's, and every cron job is unscheduled at the end of the build.
- It has no Google, Square, SMS or AI credentials, so those features don't work there.

## Known differences from production (after a build)
- The migration that sets realtime policies is skipped (a hosted project doesn't give us the owner role it needs).
- No export bucket, no `rls_auto_enable()` function, no service-role "true" policy on `veem_payer_details` (the service role bypasses row security anyway).
- Three gaps in production's own migration history are patched by `20261223130000_veem_payer_details_baseline.sql`: a table and a column that existed only in production.
