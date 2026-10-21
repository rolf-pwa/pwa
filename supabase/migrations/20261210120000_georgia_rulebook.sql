-- Georgia's rulebook: where a standing rule came from, and rules she suggests after noticing Rolf give the same answer more than once (he accepts or dismisses each).
ALTER TABLE public.ea_preferences ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'asked' CHECK (source IN ('asked', 'learned'));
ALTER TABLE public.ea_preferences ADD COLUMN IF NOT EXISTS area text;

CREATE TABLE IF NOT EXISTS public.georgia_rule_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rule text NOT NULL,
  area text,
  evidence text NOT NULL DEFAULT '',
  times int NOT NULL DEFAULT 2,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'dismissed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_rule_suggestions_unique ON public.georgia_rule_suggestions (staff_user_id, lower(rule));
ALTER TABLE public.georgia_rule_suggestions ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.georgia_rule_suggestions TO service_role;

-- Sunday 5 am Pacific (summer time; 4 am in winter): look for repeated answers.
SELECT cron.schedule(
  'georgia-rule-suggestions',
  '0 12 * * 0',
  $$
  select net.http_post(
    url := 'https://rpxevcovasrgmrzkpknu.supabase.co/functions/v1/daily-briefing-generate',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-daily-briefing-cron-secret', coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'daily_briefing_cron_secret'), '')),
    body := '{"job":"rule_suggestions"}'::jsonb
  );
  $$
);
