-- Second Brain is paused (see src/shared/lib/featureFlags.ts): its indexing job had been failing every 5 minutes
-- (BRAIN_CRON_SECRET never set) and the index was empty. Tables and functions are kept. Re-create the job to resume.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'brain-index-drain') THEN
    PERFORM cron.unschedule('brain-index-drain');
  END IF;
END $$;
