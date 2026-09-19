-- household_charters.legal_documents: persisted, per-household legal-document
-- extraction -- wills/POA/trust indentures (Vault "estate" category) and
-- shareholder agreements/corporate minute books (Vault "business" category).
-- Populated exclusively by charter-intake's new `sync_legal_documents`
-- action, which clones governance-audit-generate's Gemini PDF-extraction
-- pattern (LEGAL_FACTS_TOOL_SCHEMA) but persists results here -- that
-- function's own extraction stays ephemeral (JSONB on one audit row) and
-- never touches "business" at all; this is the first time that kind of
-- extraction becomes a durable, household-scoped, re-syncable fact base.
-- Dedup convention (external_file_id / external_modified_at) copied
-- verbatim from meeting_transcripts.
ALTER TABLE public.household_charters
  ADD COLUMN legal_documents jsonb NOT NULL DEFAULT '[]'::jsonb;
