-- On/off switches for the things Georgia does on her own between meetings. A missing row means on.
CREATE TABLE IF NOT EXISTS public.georgia_switches (
  key text PRIMARY KEY CHECK (key IN ('notice_processor', 'calendar_invites')),
  enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.georgia_switches (key) VALUES ('notice_processor'), ('calendar_invites') ON CONFLICT DO NOTHING;
ALTER TABLE public.georgia_switches ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.georgia_switches TO service_role;
