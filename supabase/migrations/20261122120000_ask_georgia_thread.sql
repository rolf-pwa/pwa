-- Ask Georgia becomes one running thread per client that Rolf can step into.
--   advisor_active        Rolf has replied and is handling it; Georgia holds her answers until he hands it back
--   last_advisor_reply_at when he last wrote
ALTER TABLE public.portal_assistant_conversations
  ADD COLUMN IF NOT EXISTS advisor_active boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_advisor_reply_at timestamptz;
