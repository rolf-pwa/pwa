-- An advisor can fill in a field the AI could not read at all (no original value), or clear one the AI got wrong (no
-- corrected value). Both are still worth recording; the missing side is stored as NULL.
ALTER TABLE public.golden_dataset_overrides ALTER COLUMN original_ai_value DROP NOT NULL;
ALTER TABLE public.golden_dataset_overrides ALTER COLUMN corrected_value DROP NOT NULL;
