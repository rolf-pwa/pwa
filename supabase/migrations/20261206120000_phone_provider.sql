-- Callizy as a second phone provider beside Quo. phone_provider_config says which one the CRM sends through (Quo unless switched);
-- both providers' inbound texts and calls land in the same quo_messages / quo_calls tables, told apart by provider.
CREATE TABLE IF NOT EXISTS public.phone_provider_config (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  provider text NOT NULL DEFAULT 'quo' CHECK (provider IN ('quo', 'callizy')),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.phone_provider_config (id) VALUES (true) ON CONFLICT DO NOTHING;
ALTER TABLE public.phone_provider_config ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.phone_provider_config TO service_role;

ALTER TABLE public.quo_messages ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'quo';
ALTER TABLE public.quo_calls ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'quo';
