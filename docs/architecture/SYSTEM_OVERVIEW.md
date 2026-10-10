# ProsperWise Portal — System Architecture Overview

_Last updated: 2026-09-23. Written for internal strategic planning use — grounded in the live codebase and production database, not aspirational._

## 1. What this system is

ProsperWise Portal is the single in-house platform for a Canadian wealth-advisory firm ("Sovereignty Operating System"). It is not a CRM with a client portal bolted on — it is one Supabase-backed monolith serving three distinct audiences through three separate front-end surfaces, sharing one data model:

1. **Advisor/staff app** — the firm's internal CRM, project management, billing, and AI-assisted governance/audit tooling.
2. **Client Portal** — a branded, token-authenticated self-service surface for clients ("Sanctuary" identity, separate from the advisor app's visual language).
3. **Professional Portal** — a lighter, token-authenticated surface for external professionals (lawyers, accountants) engaged with a household, scoped to tasks and shared Vault access only.

The product is built around a specific mental model, not generic CRM fields: household/family financial governance organized into **The Vineyard** (growth accounts), **The Storehouses** (four reserve categories: Liquidity, Strategic, Philanthropic, Legacy), **The Holding Tank** (unsorted/newly-parsed assets awaiting classification), and **The Vault** (a governed document repository proxied over Google Drive). A **Sovereignty Charter** formalizes a household's governance rules; a newer v2.0 Charter reorganizes this around a 4-Perspective Balanced Scorecard model. This domain vocabulary is load-bearing — it appears in schema, UI copy, and AI prompts consistently, and any planning work should preserve it rather than genericizing it.

## 2. Technology stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + Vite + TypeScript, Tailwind CSS + shadcn/ui, React Router v6, TanStack Query, react-hook-form + Zod |
| Backend | Supabase (Postgres 17, Row-Level Security, Auth, Edge Functions on Deno) |
| Hosting | Firebase Hosting (`app.prosperwise.ca`), deployed via GitHub Actions on merge to `main` |
| File storage | Google Drive, proxied through a custom `vault-service` edge function — **not** Supabase Storage buckets for client documents |
| AI | Google Vertex AI (Gemini 2.5 Flash/Pro), called directly via raw REST from edge functions — no AI SDK, no LangChain |
| Testing | Vitest |

The project migrated off Lovable Cloud (a managed Supabase+hosting wrapper) onto a self-owned Supabase project (`rpxevcovasrgmrzkpknu`, `ca-central-1`) and Firebase Hosting earlier in its life — this is now fully complete; no Lovable dependency remains in the runtime path.

## 3. Codebase shape

Frontend code is organized into self-contained modules under `src/modules/`, each with its own `pages/`, `components/`, and (where needed) `hooks/`/`lib/`, plus a barrel `index.ts`. ESLint enforces module boundaries — cross-module imports must go through the barrel, not reach into another module's internals.

- **`crm`** — the core advisor-facing entity model: Contacts, Households, Families, Corporations, Professionals, Pipeline (leads), Holding Tank.
- **`audit`** — governance/compliance tooling: Sovereignty Charter (v1 and v2), Stabilization Map, Quarterly Governance Audit, Quarterly System Review, Review Queue, Vault UI, the household-track "Sovereignty Survey" diagnostics.
- **`pm`** — the in-house project/task management system (replacing Asana — see §7).
- **`billing`** — Services catalog, Invoices, Square integration UI.
- **`intake`** — the guided client onboarding wizard(s): new-lead onboarding, legacy-client upgrade flow, bulk onboarding/import tooling, "Georgia 2.0" AI-driven intake chat.
- **`portal`** — the Client Portal (token-authenticated, `/portal` and `/vfo` routes).
- **`pro`** — the Professional Portal (token-authenticated, `/pro-portal` routes).
- **`brain`** — the "Second Brain" internal knowledge base (semantic search over indexed content, `brain-index`/`brain-search` edge functions).

`src/shared/` holds cross-module UI primitives (shadcn/ui wrappers, `ListRow`, `CollapsibleCard`, `AppLayout`), hooks (`useAuth`, `useGoogle*`), and the Supabase client integration.

The advisor app renders through one shared shell, `AppLayout.tsx` — icon-rail sidebar + header + `AssistantSidebar` (the AI chat panel) + `CommandPalette`. The Client and Professional Portals render standalone, with their own layout and branding, deliberately decoupled from the advisor shell (a documented project rule: advisor-app changes must not bleed into Portal styling, and vice versa).

## 4. Backend architecture

**Database**: ~100 tables in Postgres, all under Row-Level Security. The dominant RLS pattern is intentionally flat — `USING (true)` for any authenticated staff member — a deliberate small-firm design choice (every advisor works across the full client base), not an oversight; it is documented as such rather than treated as a gap to close with per-advisor RBAC.

**Edge functions**: 82 Deno functions under `supabase/functions/`, each self-contained (no shared framework beyond a `_shared/` directory of copy-pasted-by-convention helpers — CORS handling, auth checks, Vertex AI calling, PDF/Drive helpers). This "per-function duplication over cross-function imports" is a deliberate, consistently-applied convention in this codebase, not an accident — new features generally clone the nearest existing pattern rather than introducing a shared abstraction. Notable clusters:
- **Auth boundary functions**: `portal-otp`, `portal-validate`, `pro-portal-otp` (custom token-based auth for clients/pros — neither uses Supabase Auth sessions).
- **Domain services**: `pm-service` (task/project CRUD), `charter-intake` (v2.0 Charter wizard backend), `vault-service` (the Drive-proxy firewall), `square-service`/`square-webhook` (billing), `quo-service`/`quo-webhook` (calling/SMS).
- **AI-generation functions**: `stabilization-map-generate`, `generate-charter-draft`, `governance-audit-generate`, `daily-briefing-generate`, `cashflow-analyst`, `vertex-ai` (the Sovereignty Assistant/"Georgia" chat backend), and per-perspective drafting actions inside `charter-intake`.
- **Scheduled/cron functions**: `retention-review`, `service-tier-recompute`, `quarterly-vfo-audit-generate`, `daily-briefing-generate`'s cron path, `process-email-digest` — all via `pg_cron` + `pg_net`, secret-header-authenticated, dual-mode (cron path + staff-JWT interactive path where applicable).

**Auth model — three separate identity systems, deliberately not unified**:
1. Staff: native Supabase Auth via Google OAuth, domain-restricted to `@prosperwise.ca`.
2. Clients: a custom OTP/magic-link flow (`portal_tokens`, `portal_otps`) — no `auth.users` row, scoping enforced in edge-function code, not RLS.
3. Professionals: a parallel, separately-hashed token system (`pro_portal_tokens`).

## 5. AI architecture

Every AI feature calls Vertex AI's `generateContent` REST endpoint directly from an edge function via a shared `_shared/vertex-ai.ts` helper (JWT-signed service-account auth, no SDK). Two calling conventions recur throughout the codebase:

- **Single-shot structured drafting** ("forced-tool ANY mode"): one request, a forced function-call schema, no conversation state. Used for every "draft this narrative section" feature (Charter drafting, Stabilization Map narrative, Daily Briefing, governance audit extraction). Output is always a **suggestion**, never auto-applied — a shared `FieldWithSuggestion` UI pattern requires an explicit staff click to accept AI-drafted text into an editable field before it can be saved.
- **Multi-turn chat with tool-calling**: only the Sovereignty Assistant ("Georgia", `vertex-ai/index.ts`) — a chat panel mounted globally in the advisor app, proposing structured updates (create/update a contact, draft a task, etc.) that staff must explicitly approve via a `ProposedUpdateCard` before anything writes to the database.

There is **no genuine multi-step agentic loop anywhere in this codebase** — nothing feeds a tool's result back into a second model turn. Where a UI shows a staged "Research → Plan → Execute" sequence (e.g. the PM module's "AI Teammate" task-assignee feature), that is a client-side scripted animation around one real request/response, explicitly commented as such in the code — a known, intentional simplification, not a claim of real autonomy.

A known forward-looking constraint: Google is retiring Gemini 2.5 (both Flash and Pro) in this project's data-residency region (`northamerica-northeast1`) on **March 31, 2027**. ~22 edge functions hardcode a Gemini 2.5 model string. Migrating the one genuinely multi-turn function (Georgia) is nontrivial — Gemini 3's tool-calling protocol requires capturing and replaying an opaque `thoughtSignature` field that raw-REST callers (this codebase) must implement by hand, unlike SDK users. The other ~21 call sites are lower-risk, single-shot swaps. This is tracked but not yet started.

## 6. External integrations

| Integration | Role | Trajectory |
|---|---|---|
| **Google Workspace** | Per-staff OAuth (Gmail, Calendar, Drive, Docs, Sheets) — powers Vault document storage, meeting-transcript sync, email send/tracking, calendar-aware briefings | Stable, core dependency |
| **Google Vertex AI** | All AI generation (see §5) | Stable; model-retirement deadline noted above |
| **Square** | Invoicing, checkout/booking payments, webhook-driven invoice lifecycle | Stable, actively used |
| **Asana** | Historically the firm's task system | **Being decommissioned** — fully superseded by the in-house PM module (`src/modules/pm/`, backed by `pm_tasks`/`pm_projects`/`pm_task_comments`). All CRM, Portal, and Professional Portal task surfaces have been migrated off Asana; a full historical backfill has run. `asana-service` and related functions remain live only as a wind-down tail, not for new development. |
| **Quo (OpenPhone under the hood)** | Firm phone/SMS — call logging, transcripts, inbox | Stable |
| **Wix** | Legacy blog/marketing site relay | Deprecated, being phased out in favor of native email (`send-admin-email` via the firm's own Gmail) |
| **Resend** | Transactional email | Stable, secondary to the Gmail-based send path |

## 7. Core domain systems, briefly

- **Sovereignty Charter v1 vs v2.0**: v1 is contact-scoped (one Charter per adult), a legacy model being phased out household-by-household. v2.0 is household-scoped and structured around a 4-Perspective Balanced Scorecard (Treasury & Capital Structure; Family Well-Being & Stakeholder Harmony; Operating Governance & Spoke Orchestration; Human Capital & Generational Stewardship) plus a "Foundational Bedrock" (vision, values, grounding principles). v2.0 is the active development target; v1 is untouched legacy, migrated per-household on demand.
- **In-house PM system**: purpose-built to replace Asana, covering staff task management, client-visible/internal task distinction, professional tagging/collaboration, and AI-teammate-assisted task drafting — all natively integrated with the household/contact/corporation entity graph in a way Asana never was.
- **Vault**: not Supabase Storage — a governed proxy over Google Drive with a per-actor access firewall (staff / client / guest collaborator / linked professional), full audit logging, and folder-template-driven provisioning per household.
- **Service Tiering**: a computed client-segmentation engine (6 tiers, AUM-pooled at the family level across households/corporations, gated partly on Sovereignty Charter ratification) driving review cadence and fee structure — currently staff-facing only; client-facing rollout is roadmapped for January 2027.
- **Compliance/audit layer**: PII-outbound-content filtering (`pii-shield.ts`, applied to every outbound client message channel), a full `sovereignty_audit_trail`/`vault_audit_log`, a `security-audit` function running automated self-tests (RLS isolation, webhook signature verification, credential validity) on a schedule, and a written data-retention/self-service-access-request policy (7-year retention from relationship end, staff-reviewed, never automatic; clients can request a copy of their data but cannot request deletion within that window).

## 8. Deployment & operations

- **Frontend**: GitHub Actions (`firebase-hosting-merge.yml`) builds and deploys to Firebase Hosting automatically on merge to `main`. No separate staging environment; branches are reviewed and merged directly.
- **Backend**: schema changes are plain SQL migration files (`supabase/migrations/`, ~196 as of this writing) applied via `supabase db push` against the linked project. Edge functions are deployed individually via `supabase functions deploy <name>` — **not** covered by the frontend's `tsc`/`vite build` type-checking, a known verification gap (Deno-runtime code needs its own deploy-or-`deno check` pass).
- **Secrets**: managed via Supabase's edge-function secret store and Postgres Vault for cron-job authentication headers; never committed to git.
- **No automated database backups were configured as of the last infrastructure review** — flagged in the firm's own compliance documentation as an open item, not yet resolved.
- **Scheduled jobs**: `pg_cron` + `pg_net`, secret-header-authenticated HTTP calls into edge functions, documented per-job in their own migration files.

## 9. Architectural conventions worth preserving in any planning

- **AI never auto-applies.** Every AI-drafted field requires an explicit human acceptance click before it becomes real data. This is a consistent, deliberate pattern across the whole codebase, not a per-feature choice.
- **Honest scoping over fabricated automation.** Where no real data exists to compute a metric (e.g. certain KPIs referenced in internal strategy docs with no supporting schema), the system is built to say so explicitly (an honest "not yet computed" placeholder) rather than fabricate a plausible-looking number. This shows up repeatedly in code comments and is treated as a hard rule, not a nice-to-have.
- **Disposable-data verification discipline.** Nearly every feature in this codebase's history was verified against real infrastructure using isolated, clearly-prefixed (`ZZ-TEST`/`zz_test_`) throwaway records, cleaned up after — not mocked. This reflects a broader "verify against reality, not assumptions" engineering culture worth factoring into how aggressively new work can be trusted without a human click-through pass (staff-authenticated surfaces in particular cannot be browser-verified in most automated/sandboxed contexts — a standing, acknowledged limitation).
- **Per-function duplication is intentional in the edge-function layer.** Do not assume a shared library exists for a given cross-cutting concern (CORS, PDF/print layout, PII filtering, Drive access) just because one function has it — check whether the pattern has actually been extracted to `_shared/` or merely cloned.
- **Module boundaries are enforced, not just conventional.** ESLint blocks deep imports across `src/modules/*` boundaries for most (not yet all) modules — a real constraint on how features can be wired together.

## 10. Known open strategic threads

These are live, acknowledged directions rather than closed decisions — useful context for planning, not commitments:

- **Full Asana decommission** — task migration is complete; the remaining work is rewiring a handful of peripheral touchpoints (governance-drift alerts, a health-check job) and revoking the API token once nothing depends on it.
- **Gemini 2.5 → next-generation model migration** — hard deadline March 31, 2027; not yet started.
- **Sovereignty Financial Planning Engine (SFPE)** — a fully-researched, detailed, but explicitly deferred plan for a real-time, goal-based Canadian financial-planning calculation engine (RRSP/TFSA/CPP/OAS, corporate tax structures) — parked at the firm's own request pending prioritization, not abandoned.
- **Client-facing Service Tier rollout** — engine is built and staff-facing; client communication scripts, calendar/booking wiring, and automated tier-change emails are scoped for January 2027.
- **"Librarian Agent" concept** — an architecture-only sketch (not yet planned in detail) for autonomous compliance-document classification landing in designated Vault subfolders, deliberately waiting on a firm-supplied required-document list before real design work begins.

---

_This document reflects the system as verified against the live codebase and production database on 2026-09-23. It is not a historical changelog — for a detailed, chronological record of every feature decision and its rationale, the engineering team maintains a much more granular internal plan log._
