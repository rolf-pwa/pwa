-- Which screens staff open and how often, so the navigation can be trimmed by use rather than by guess. One row per screen opened: the path with ids taken out, who, when.
-- Nothing about what was on the screen. Staff can add their own rows; reading it is for the administrator (the service role).
CREATE TABLE IF NOT EXISTS public.staff_page_views (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL DEFAULT auth.uid(),
  path text NOT NULL CHECK (char_length(path) <= 200),
  viewed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_staff_page_views_path ON public.staff_page_views (path, viewed_at DESC);
ALTER TABLE public.staff_page_views ENABLE ROW LEVEL SECURITY;
GRANT INSERT ON public.staff_page_views TO authenticated;
GRANT ALL ON public.staff_page_views TO service_role;
CREATE POLICY "Staff add their own page views" ON public.staff_page_views FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
