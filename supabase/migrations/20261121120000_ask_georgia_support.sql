-- Ask Georgia as client support: every conversation is kept for review, and Rolf can mark himself away.
--   portal_assistant_conversations  one row per chat; flagged when Georgia hands something to Rolf
--   staff_availability              a single row: the dates Rolf is away and what clients are told

CREATE TABLE IF NOT EXISTS public.portal_assistant_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  messages jsonb NOT NULL DEFAULT '[]'::jsonb,
  flag text CHECK (flag IN ('urgent', 'routine')),
  flag_summary text,
  flagged_at timestamptz,
  away_when_flagged boolean NOT NULL DEFAULT false,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pac_contact ON public.portal_assistant_conversations (contact_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_pac_attention ON public.portal_assistant_conversations (flagged_at) WHERE flag IS NOT NULL AND reviewed_at IS NULL;

ALTER TABLE public.portal_assistant_conversations ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.portal_assistant_conversations TO service_role;

CREATE TABLE IF NOT EXISTS public.staff_availability (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  away_from date,
  away_until date,
  note text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.staff_availability (id) VALUES (true) ON CONFLICT DO NOTHING;

ALTER TABLE public.staff_availability ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.staff_availability TO service_role;
