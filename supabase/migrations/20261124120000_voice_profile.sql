-- Rolf's Voice DNA: the Google Doc Georgia reads before she writes anything that goes out under his name.
-- One row; the text is a copy of the Doc, refreshed from Drive at most once a day, so editing the Doc changes every later draft.
CREATE TABLE IF NOT EXISTS public.voice_profile (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  doc_id text NOT NULL,
  content text NOT NULL DEFAULT '',
  fetched_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.voice_profile (id, doc_id) VALUES (true, '1r0nxeJBTo_H7SyiFeUlf4EQ4agj1GxDg4X3jJK3ttCo') ON CONFLICT DO NOTHING;

ALTER TABLE public.voice_profile ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.voice_profile TO service_role;
