-- On the 1st of each month, give Rolf the task for his part of the monthly round: the iA file is dated the last day of
-- the month that just ended (iA updates nightly, so the 1st is fine). It is created at 4:00 a.m. Pacific so the 6:00 a.m.
-- daily briefing includes it. One task with a checklist of subtasks, internal only. Skips if it already exists.
-- (A one-off job; the general recurring-workflow engine, when built, can replace it.)
CREATE OR REPLACE FUNCTION public.create_monthly_import_task() RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  owner uuid;
  month_end date := (date_trunc('month', now() AT TIME ZONE 'America/Vancouver')::date - 1);
  label text := to_char(month_end, 'FMMonth FMDD, YYYY');
  parent_title text := 'Monthly import: ' || to_char(month_end, 'FMMonth FMDD, YYYY') || ' data';
  parent uuid;
  due date := date_trunc('month', now() AT TIME ZONE 'America/Vancouver')::date;
  step text;
  steps text[] := ARRAY[
    'Download the iA performance file (dated ' || to_char(month_end, 'FMMonth FMDD') || ')',
    'Add the JustWealth rows (account number, account type, balance, and a Custodian column)',
    'Importers > Monthly Performance: upload, Preview and review the exceptions and the missing-accounts list',
    'Tick any exceptions you accept, then Import',
    'Send the balances-updated notice from Georgia (preview who is notified, then send)'
  ];
BEGIN
  SELECT user_id INTO owner FROM profiles WHERE email = 'rolf@prosperwise.ca';
  IF owner IS NULL THEN RETURN NULL; END IF;
  IF EXISTS (SELECT 1 FROM pm_tasks WHERE title = parent_title AND assignee_id = owner) THEN RETURN NULL; END IF;
  INSERT INTO pm_tasks (title, description, status, due_date, assignee_id, created_by, client_visible)
  VALUES (parent_title, 'Your part of the monthly round: the file from iA, the JustWealth rows, the import and the client notice. Everything else is automatic.', 'open', due, owner, owner, false)
  RETURNING id INTO parent;
  FOREACH step IN ARRAY steps LOOP
    INSERT INTO pm_tasks (title, status, due_date, assignee_id, created_by, client_visible, parent_task_id)
    VALUES (step, 'open', due, owner, owner, false, parent);
  END LOOP;
  RETURN parent;
END $$;
REVOKE ALL ON FUNCTION public.create_monthly_import_task() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_monthly_import_task() TO service_role;

-- 4:00 a.m. Pacific on the 1st. pg_cron runs in UTC, so it fires at 11:00 and 12:00 UTC and the command only acts in the
-- hour that is 4 a.m. in Vancouver (summer or winter time). The task is due the same day.
SELECT cron.schedule('monthly-import-task', '0 11,12 1 * *',
  $$select public.create_monthly_import_task() where extract(hour from now() at time zone 'America/Vancouver') = 4;$$);
