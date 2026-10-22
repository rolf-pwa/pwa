-- Insurance files: one per insurance sale or policy, with a compliance checklist and an audit package built in Drive.
--   insurance_files        the sale or policy (new sale, replacement, in-force review) for a household
--   insurance_file_items   the evidence attached for each checklist item (a Drive file, or a meeting record), or "not applicable"
-- Georgia checks open files each morning and makes one task when required items are missing. The audit package is a dated folder in the household's
-- Advisor Files with copies of the evidence and an index document; nothing in Drive is moved or deleted.
CREATE TABLE IF NOT EXISTS public.insurance_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  policy_id uuid REFERENCES public.insurance_policies(id) ON DELETE SET NULL,
  contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  title text NOT NULL,
  kind text NOT NULL DEFAULT 'new_sale' CHECK (kind IN ('new_sale', 'replacement', 'in_force_review')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'complete')),
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  package_folder_id text,
  package_url text,
  packaged_at timestamptz,
  last_nudged_at timestamptz,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_insurance_files_household ON public.insurance_files (household_id, status);

CREATE TABLE IF NOT EXISTS public.insurance_file_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_id uuid NOT NULL REFERENCES public.insurance_files(id) ON DELETE CASCADE,
  kind text NOT NULL,
  status text NOT NULL DEFAULT 'provided' CHECK (status IN ('provided', 'not_applicable')),
  drive_file_id text,
  drive_name text,
  drive_url text,
  meeting_task_id uuid REFERENCES public.pm_tasks(id) ON DELETE SET NULL,
  note text,
  added_by text,
  added_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_insurance_file_items_file ON public.insurance_file_items (file_id, kind);

ALTER TABLE public.insurance_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.insurance_file_items ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.insurance_files, public.insurance_file_items TO service_role;

-- Every morning at 7 am Pacific (summer time; 6 am in winter): Georgia checks the open files.
SELECT cron.schedule(
  'insurance-file-check',
  '0 14 * * *',
  $$
  select net.http_post(
    url := 'https://rpxevcovasrgmrzkpknu.supabase.co/functions/v1/daily-briefing-generate',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-daily-briefing-cron-secret', coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'daily_briefing_cron_secret'), '')),
    body := '{"job":"insurance_file_check"}'::jsonb
  );
  $$
);
