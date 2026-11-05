-- A review added by hand for a window the tier's schedule does not include (for example a household's first review, in the quarter it joins Georgia Reviews).
-- Georgia's weekly run cancels an open obligation the schedule no longer owes; one marked manual is never cancelled that way.
ALTER TABLE public.review_obligations ADD COLUMN IF NOT EXISTS manual boolean NOT NULL DEFAULT false;
