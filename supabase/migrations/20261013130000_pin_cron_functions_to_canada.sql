-- Scheduled jobs call Edge Functions through pg_net, and without a region header those run at the nearest
-- edge location (usually the US). Pin them to ca-central-1, the same region as the database.
DO $$
DECLARE j record;
BEGIN
  FOR j IN SELECT jobid, command FROM cron.job WHERE command LIKE '%/functions/v1/%' AND command NOT LIKE '%x-region%' LOOP
    PERFORM cron.alter_job(
      j.jobid,
      command := replace(j.command, '''Content-Type'', ''application/json'',', '''Content-Type'', ''application/json'', ''x-region'', ''ca-central-1'',')
    );
  END LOOP;
END $$;
