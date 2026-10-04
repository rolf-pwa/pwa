# Sub-processor Registry (Template)

This is a template, not a finished record. It lists the third-party services ProsperWise Portal actually integrates with today (derived from [`CONTROLS_MAPPING.md`](./CONTROLS_MAPPING.md) §13), so vendor confirmation can happen against a concrete, accurate list rather than from memory. This document does not, by itself, certify that a Data Processing Agreement (DPA) exists with any vendor — the "DPA Status" column must be filled in after directly confirming with each vendor, not assumed or inferred.

| Vendor | What data they process | Purpose | DPA Status | DPA Link/Reference | Confirmed Date |
|---|---|---|---|---|---|
| Google Workspace | Client emails, calendar events, Drive/Vault documents, Sheets analytics data | Staff productivity, secure document storage (Vault), Gmail/Calendar integration | _Not yet confirmed_ | | |
| Square | Client name, email, invoice line items (no card data — Square hosts the payment page directly) | Payment processing / invoicing | _Not yet confirmed_ | | |
| Asana | Client names (where staff include them in task titles/notes) | Internal task and workflow management | _Not yet confirmed_ | | |
| Quo / OpenPhone | Contact name, phone number, call recordings, transcripts, SMS content | Dialer / client communication (US-hosted infrastructure) | _Not yet confirmed_ | | |
| Wix | Marketing site content; historically some email relay functionality (being phased out — see `PRIVACY_AND_SECURITY_POLICY.md`) | Public marketing site, legacy email relay | _Not yet confirmed_ | | |
| Supabase | All application data (database, auth, storage, edge functions) | Core application backend | Confirmed (automatic) | [supabase.com/legal/dpa](https://supabase.com/legal/dpa) — incorporated into Terms of Service for all orgs, no separate signature needed | 2026-08-26 |
| Google Cloud (Vertex AI) | Content sent to AI features (charter drafts, governance alignment, cashflow analysis, client and staff assistants, document extraction, Shoebox classification, safety screening); processed in the Montréal region (see CONTROLS_MAPPING section 17) | AI-assisted features | _Not yet confirmed_ | | |
| Google Cloud (Firebase) | No client data directly — hosts the compiled frontend application | Application hosting | _Not yet confirmed_ | | |

## How to use this document

For each vendor: check whether they have a standard DPA available (most major providers — Google, Square, Asana — publish one you can review and accept directly in their admin console or trust/legal center), confirm it covers the categories of data actually in use here, record the date confirmed and a reference link, and update the corresponding entry in `CONTROLS_MAPPING.md` §13 to point at this document once populated.

This document should be reviewed whenever a new third-party integration is added, or at least annually.
