-- Georgia answering simple, non-financial portal requests without a task: the groundwork. Nothing here changes what a client or Rolf sees.
-- Plan: docs/georgia-portal-autonomy-plan.md. Everything starts switched off.

-- What happened to a request, so a handled one needs no task. All nullable: existing rows and the current flow are untouched.
ALTER TABLE public.portal_requests ADD COLUMN IF NOT EXISTS outcome text CHECK (outcome IN ('answered', 'done', 'drafted', 'handed_over'));
ALTER TABLE public.portal_requests ADD COLUMN IF NOT EXISTS handled_by text CHECK (handled_by IN ('georgia', 'rolf'));
ALTER TABLE public.portal_requests ADD COLUMN IF NOT EXISTS category text;
-- Georgia's triage of the request: the category, the gate reasons, and what she would have done (the shadow record).
ALTER TABLE public.portal_requests ADD COLUMN IF NOT EXISTS triage jsonb;

-- The master switch (one row), off until Rolf turns it on.
CREATE TABLE IF NOT EXISTS public.georgia_autonomy_master (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text
);
INSERT INTO public.georgia_autonomy_master (id) VALUES (true) ON CONFLICT DO NOTHING;

-- One row per kind of request, each with its own mode: off, shadow (recorded, still Rolf's), draft (prepared for his approval) or auto.
CREATE TABLE IF NOT EXISTS public.georgia_autonomy_config (
  category text PRIMARY KEY CHECK (category IN ('status', 'documents', 'meetings', 'ia_self_serve', 'contact_details')),
  mode text NOT NULL DEFAULT 'off' CHECK (mode IN ('off', 'shadow', 'draft', 'auto')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text
);
INSERT INTO public.georgia_autonomy_config (category) VALUES ('status'), ('documents'), ('meetings'), ('ia_self_serve'), ('contact_details') ON CONFLICT DO NOTHING;

-- What Georgia did on her own, for review and for undoing a change. Never holds a contract number or any banking detail: a contact change keeps
-- the old and new value (so it can be undone), a contract number shown is recorded by who, which contract and when.
CREATE TABLE IF NOT EXISTS public.georgia_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  request_id uuid REFERENCES public.portal_requests(id) ON DELETE SET NULL,
  category text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('answered', 'done', 'drafted', 'handed_over', 'contract_number_shown', 'contact_updated')),
  summary text NOT NULL,
  detail jsonb,
  undone_at timestamptz,
  undone_by text
);
CREATE INDEX IF NOT EXISTS idx_georgia_actions_created ON public.georgia_actions (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_georgia_actions_contact ON public.georgia_actions (contact_id, created_at DESC);

ALTER TABLE public.georgia_autonomy_master ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.georgia_autonomy_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.georgia_actions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.georgia_autonomy_master, public.georgia_autonomy_config, public.georgia_actions FROM anon, authenticated;
GRANT SELECT, UPDATE ON public.georgia_autonomy_master TO authenticated;
GRANT SELECT, UPDATE ON public.georgia_autonomy_config TO authenticated;
GRANT SELECT, UPDATE ON public.georgia_actions TO authenticated;
GRANT ALL ON public.georgia_autonomy_master, public.georgia_autonomy_config, public.georgia_actions TO service_role;

-- Staff only (a @prosperwise.ca login) read the three tables and change the two settings tables and mark an action undone; the functions write with the service role.
DROP POLICY IF EXISTS "Staff read georgia_autonomy_master" ON public.georgia_autonomy_master;
CREATE POLICY "Staff read georgia_autonomy_master" ON public.georgia_autonomy_master FOR SELECT TO authenticated USING (lower(coalesce(auth.jwt() ->> 'email', '')) LIKE '%@prosperwise.ca');
DROP POLICY IF EXISTS "Staff update georgia_autonomy_master" ON public.georgia_autonomy_master;
CREATE POLICY "Staff update georgia_autonomy_master" ON public.georgia_autonomy_master FOR UPDATE TO authenticated USING (lower(coalesce(auth.jwt() ->> 'email', '')) LIKE '%@prosperwise.ca') WITH CHECK (lower(coalesce(auth.jwt() ->> 'email', '')) LIKE '%@prosperwise.ca');
DROP POLICY IF EXISTS "Staff read georgia_autonomy_config" ON public.georgia_autonomy_config;
CREATE POLICY "Staff read georgia_autonomy_config" ON public.georgia_autonomy_config FOR SELECT TO authenticated USING (lower(coalesce(auth.jwt() ->> 'email', '')) LIKE '%@prosperwise.ca');
DROP POLICY IF EXISTS "Staff update georgia_autonomy_config" ON public.georgia_autonomy_config;
CREATE POLICY "Staff update georgia_autonomy_config" ON public.georgia_autonomy_config FOR UPDATE TO authenticated USING (lower(coalesce(auth.jwt() ->> 'email', '')) LIKE '%@prosperwise.ca') WITH CHECK (lower(coalesce(auth.jwt() ->> 'email', '')) LIKE '%@prosperwise.ca');
DROP POLICY IF EXISTS "Staff read georgia_actions" ON public.georgia_actions;
CREATE POLICY "Staff read georgia_actions" ON public.georgia_actions FOR SELECT TO authenticated USING (lower(coalesce(auth.jwt() ->> 'email', '')) LIKE '%@prosperwise.ca');
DROP POLICY IF EXISTS "Staff update georgia_actions" ON public.georgia_actions;
CREATE POLICY "Staff update georgia_actions" ON public.georgia_actions FOR UPDATE TO authenticated USING (lower(coalesce(auth.jwt() ->> 'email', '')) LIKE '%@prosperwise.ca') WITH CHECK (lower(coalesce(auth.jwt() ->> 'email', '')) LIKE '%@prosperwise.ca');
