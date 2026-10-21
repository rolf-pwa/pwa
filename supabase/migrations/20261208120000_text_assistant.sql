-- Georgia answers clients' texts for Rolf when he is in a meeting, away, or after hours. enabled is the off switch (also on the Inbox page).
CREATE TABLE IF NOT EXISTS public.text_assistant_config (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.text_assistant_config (id) VALUES (true) ON CONFLICT DO NOTHING;
ALTER TABLE public.text_assistant_config ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.text_assistant_config TO service_role;
