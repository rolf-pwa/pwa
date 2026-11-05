-- British Columbia stopped changing its clocks: it went forward on 2026-03-08 and does not go back, so Pacific time is UTC-7 for good.
-- Postgres's own zone data (17.6 here) still has America/Vancouver falling back to UTC-8 from 2026-11-01, so anything that asked for "the hour in
-- Vancouver" was an hour early. "Etc/GMT+7" is UTC-7 all year (the sign is the POSIX one). Only the places that meant Pacific time are changed.

-- The AI usage page's days (every row is from after the change).
CREATE OR REPLACE FUNCTION public.ai_usage_summary(days integer DEFAULT 30)
RETURNS TABLE (day date, label text, model text, calls bigint, prompt_tokens bigint, cached_tokens bigint, output_tokens bigint, thinking_tokens bigint)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT (created_at AT TIME ZONE 'Etc/GMT+7')::date, label, model, count(*), sum(prompt_tokens)::bigint, sum(cached_tokens)::bigint, sum(output_tokens)::bigint, sum(thinking_tokens)::bigint
  FROM public.ai_usage
  WHERE created_at >= now() - make_interval(days => GREATEST(days, 1))
  GROUP BY 1, 2, 3
$$;
REVOKE ALL ON FUNCTION public.ai_usage_summary(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ai_usage_summary(integer) TO authenticated, service_role;

-- The monthly import task, made at 4:00 a.m. Pacific on the 1st.
CREATE OR REPLACE FUNCTION public.create_monthly_import_task() RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  owner uuid;
  month_end date := (date_trunc('month', now() AT TIME ZONE 'Etc/GMT+7')::date - 1);
  label text := to_char(month_end, 'FMMonth FMDD, YYYY');
  parent_title text := 'Monthly import: ' || to_char(month_end, 'FMMonth FMDD, YYYY') || ' data';
  parent uuid;
  due date := date_trunc('month', now() AT TIME ZONE 'Etc/GMT+7')::date;
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

-- 4:00 a.m. Pacific on the 1st is 11:00 UTC all year now. The 12:00 UTC run is kept (it never matches) so nothing else about the schedule moves.
SELECT cron.schedule('monthly-import-task', '0 11,12 1 * *',
  $$select public.create_monthly_import_task() where extract(hour from now() at time zone 'Etc/GMT+7') = 4;$$);
