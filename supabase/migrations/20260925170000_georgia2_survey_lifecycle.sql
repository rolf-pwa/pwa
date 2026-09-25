-- Georgia strategy update, Phase C: payment-handoff lifecycle.
-- A visitor who clicks "Start the Sovereignty Survey" is marked
-- status = 'pending_survey_payment' with survey_clicked_at (set by
-- georgia2-lead). convertMatchingLeads() flips them to converted_to_contact
-- when they actually pay. One that is still pending 48h later gets a single
-- abandoned-cart email (georgia2-abandoned-cart); abandoned_cart_sent_at is
-- the once-only guard.
ALTER TABLE public.georgia2_leads
  ADD COLUMN IF NOT EXISTS survey_clicked_at timestamptz,
  ADD COLUMN IF NOT EXISTS abandoned_cart_sent_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_georgia2_leads_pending_survey
  ON public.georgia2_leads (survey_clicked_at)
  WHERE status = 'pending_survey_payment' AND abandoned_cart_sent_at IS NULL;
