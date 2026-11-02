-- What each Gemini call used, so the AI bill can be traced to a feature. One row per call: the file that made it, the model and the token counts
-- Vertex reports (never the prompt or the answer). Written by the edge functions with the service role; staff (a @prosperwise.ca login) can read it.
CREATE TABLE IF NOT EXISTS public.ai_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  label text NOT NULL,
  model text NOT NULL,
  prompt_tokens integer NOT NULL DEFAULT 0,
  cached_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  thinking_tokens integer NOT NULL DEFAULT 0,
  total_tokens integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_ai_usage_created ON public.ai_usage (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_usage_label ON public.ai_usage (label, created_at DESC);

ALTER TABLE public.ai_usage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_usage FROM anon, authenticated;
GRANT SELECT ON public.ai_usage TO authenticated;
GRANT ALL ON public.ai_usage TO service_role;
DROP POLICY IF EXISTS "Staff read ai_usage" ON public.ai_usage;
CREATE POLICY "Staff read ai_usage" ON public.ai_usage FOR SELECT TO authenticated
  USING (lower(coalesce(auth.jwt() ->> 'email', '')) LIKE '%@prosperwise.ca');

-- The page's numbers, added up in the database (a month of calls is more rows than one page read returns). Runs as the caller, so the staff-only policy applies.
CREATE OR REPLACE FUNCTION public.ai_usage_summary(days integer DEFAULT 30)
RETURNS TABLE (day date, label text, model text, calls bigint, prompt_tokens bigint, cached_tokens bigint, output_tokens bigint, thinking_tokens bigint)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT (created_at AT TIME ZONE 'America/Vancouver')::date, label, model, count(*), sum(prompt_tokens)::bigint, sum(cached_tokens)::bigint, sum(output_tokens)::bigint, sum(thinking_tokens)::bigint
  FROM public.ai_usage
  WHERE created_at >= now() - make_interval(days => GREATEST(days, 1))
  GROUP BY 1, 2, 3
$$;
REVOKE ALL ON FUNCTION public.ai_usage_summary(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ai_usage_summary(integer) TO authenticated, service_role;
