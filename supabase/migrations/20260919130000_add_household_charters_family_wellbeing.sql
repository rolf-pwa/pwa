-- household_charters: Perspective 2 "Family Well-Being & Stakeholder Harmony"
-- columns. meeting_transcripts is populated exclusively by charter-intake's
-- `sync_meeting_transcripts` action, which pulls files directly from each
-- household's "Advisor Files / Meeting Notes" Drive folder (see
-- _shared/vault-provisioning.ts's ADVISOR_SUBFOLDERS) -- never hand-pasted.
-- external_file_id / external_modified_at are the sync dedup keys, mirroring
-- sovereignty_charter_sources' identical convention (allow a re-sync to skip
-- unchanged files and re-ingest ones whose Drive modifiedTime moved).
--
-- The six narrative columns map one-to-one to the doc's Perspective 2
-- concepts (Discretionary Trust Guidelines / POA & Incapacity Protocol /
-- Shareholder Voting & Succession Philosophy / the Sovereignty Boundary
-- Protocol / Capital Request Framework / Matrimonial & Asset Ring-Fencing)
-- -- plain text, matching vision_text's pattern, since each is one
-- freeform narrative, not an enumerable list.
ALTER TABLE public.household_charters
  ADD COLUMN meeting_transcripts jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN discretionary_trust_guidelines text,
  ADD COLUMN poa_incapacity_protocol text,
  ADD COLUMN shareholder_voting_philosophy text,
  ADD COLUMN boundary_protocol_note text,
  ADD COLUMN capital_request_framework_note text,
  ADD COLUMN matrimonial_ringfencing_note text;
