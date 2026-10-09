-- The client portal's Governance Timeline used to show every audit-trail entry, including internal system records (contact
-- merges with raw record ids, AI-assistant actions). Only entries explicitly marked client-visible are served to clients.
ALTER TABLE public.sovereignty_audit_trail ADD COLUMN IF NOT EXISTS client_visible boolean NOT NULL DEFAULT false;
