-- Product and stage rename: Sovereignty Survey -> Transition Survey, Clarity Call -> Talk It Through.
-- Stored settings only: documents already issued to clients keep the wording they were issued with. Internal keys,
-- routes and enum values are unchanged.

UPDATE public.meeting_types SET label = 'Transition Survey' WHERE label = 'Sovereignty Survey';
UPDATE public.meeting_types SET label = 'Talk It Through with Rolf' WHERE label = 'Clarity Call with Rolf';
UPDATE public.meeting_types SET note = replace(note, 'Sovereignty Survey', 'Transition Survey') WHERE note LIKE '%Sovereignty Survey%';
UPDATE public.meeting_types SET client_label = 'Transition Survey' WHERE client_label = 'Sovereignty Survey';
UPDATE public.meeting_types SET client_label = 'Talk It Through' WHERE client_label IN ('Clarity Call', 'Clarity Call with Rolf');

UPDATE public.services SET name = replace(name, 'Sovereignty Survey', 'Transition Survey') WHERE name LIKE 'Sovereignty Survey%';
