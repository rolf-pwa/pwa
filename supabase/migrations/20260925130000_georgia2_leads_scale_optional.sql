-- The Georgia diagnostic no longer asks for the size of the capital event
-- (person-first redesign), so a lead's scale is now unknown for new
-- submissions. Existing rows keep whatever they recorded.
ALTER TABLE public.georgia2_leads ALTER COLUMN scale DROP NOT NULL;
