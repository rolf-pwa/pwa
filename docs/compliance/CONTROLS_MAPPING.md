# Controls Mapping (Internal)

Internal reference mapping every claim in [`PRIVACY_AND_SECURITY_POLICY.md`](./PRIVACY_AND_SECURITY_POLICY.md) to the actual code, database schema, or infrastructure that implements it. Keep this in sync with the codebase — if a control here changes or is removed, update the external policy in the same change.

Last verified against: `main` branch state, 2026-08-10.

---

## 1. Authentication & access control

| Claim | Implementation |
|---|---|
| Staff sign-in is restricted to `@prosperwise.ca` Google accounts | `src/shared/lib/auth.ts` — `signInWithGoogle()` via native Supabase OAuth; domain restriction enforced via `isAllowedDomain()` checks and `hd: "prosperwise.ca"` param on the Workspace-connector auth flow (`supabase/functions/google-auth/index.ts`) |
| Client portal access requires a one-time passcode, not a password | `supabase/functions/portal-otp/index.ts` — 6-digit OTP via `crypto.getRandomValues` (rejection sampling, no modulo bias), stored in `portal_otps`, delivered by email |
| Repeated failed passcode attempts are locked out | `portal-otp` — lockout after 5 failed attempts with progressive delay; covered by an automated self-test in `security-audit` |
| Returning devices can skip re-entering a passcode via a secure trusted-device token | `supabase/functions/_shared/trusted-device.ts` — 32-byte random token; only its SHA-256 hash (`token_hash`) is persisted, never the raw token |
| Clients never receive direct database access | Portal frontend (`src/modules/portal/`) never calls `supabase.from()` — all client requests are proxied through edge functions using the service-role key, with server-side scoping (see §6) |

**Design decision, not a gap:** there is no role-based access control (RBAC) layer. Any authenticated `@prosperwise.ca` account has the same broad access to staff-facing tables (see §2). This is deliberate: ProsperWise is a small advisory team where every staff member works across the client base, so per-advisor/least-privilege scoping would add engineering and operational overhead without a corresponding security benefit for a firm this size. Access control is enforced at the boundary that actually matters here — who can authenticate at all (domain-gated to `@prosperwise.ca`) — rather than through internal role segmentation. Revisit if the team structure changes (e.g. advisors who should not see each other's clients).

## 2. Row Level Security (database-level access control)

- All 84 tables in the `public` schema have Row Level Security **enabled** (verified: `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` present for all 84, deduplicated across migrations).
- 204 distinct named policies exist across 144 migrations (`supabase/migrations/`) — verified by deduplicating `CREATE POLICY` statements by name+table; the raw statement count is higher (384) because policies are iteratively dropped and recreated as they're refined (107 `DROP POLICY` statements reflect that iteration, not policy loss).
- Pattern: most staff-facing tables (contacts, households, families, corporations, vault metadata, etc.) use `TO authenticated USING (true)` — any authenticated staff account can read/write. This is a flat trust model, not per-advisor row scoping.
- A smaller set of self-service tables restrict to `auth.uid() = user_id` (e.g. `profiles`).
- Client-facing tables (`portal_tokens`, `portal_otps`, etc.) have no direct client grants — reachable only through edge functions running as service-role.

**Design decision, not a gap:** `portal-uploads` storage bucket policy grants `SELECT` to any authenticated staff user rather than scoping to the relevant household — same intentional flat-trust model as §1, for the same reason (small team, full client-base visibility by design).

## 3. Client portal data scoping

Client identity is established by OTP or portal Google login (`portal-otp`, `portal-validate`), then a session token (`portal_tokens`) or trusted-device token is issued. From that point, every subsequent data query in the portal edge functions is scoped by explicit `.eq("contact_id", ...)` / `.eq("household_id", ...)` filters in code (e.g. `vineyard_accounts`, `storehouses`, `sovereignty_audit_trail`, `portal_requests`).

**Important nuance:** because these edge functions run with the service-role key (which bypasses RLS), the correctness of "a client only sees their own household's data" depends on consistent, correct manual filtering across every relevant edge function — not on a single database-enforced guarantee. This is a real architectural distinction worth understanding: it is enforced in application code, reviewed function-by-function, not by the database itself for this identity type.

## 4. Vault (secure document storage)

- Implementation: `supabase/functions/vault-service/index.ts`. Proxies **Google Drive** (not Supabase Storage) behind a per-actor access-control layer.
- Actor types: `staff` (Supabase JWT), `client` (portal token bound to the household's `vault_root_folder_id`), `collaborator` (guest token + unlock code, scoped via `vault_collaborator_grants`), `share_link` (`vault_share_links`, with view/upload/download tiers).
- Every access calls `ensureAccess()`, which walks the Drive folder ancestor chain (cached in `vault_files`) to confirm the requested file/folder is actually reachable from the actor's permitted root.
- Clients have an additional optional "Shoebox-only" restriction, and files require a staff-set `client_visible` flag before being shown to a client.
- All actions are logged to `vault_audit_log` (actor, IP, user-agent, action, Drive object id).
- Frontend never talks to Google Drive directly — always through `vault-service` (`src/modules/crm/pages/Vault.tsx`, `src/modules/portal/pages/VaultGuest.tsx`, `PortalVault.tsx`).

## 5. Secrets management

- All third-party API keys and credentials are read via `Deno.env.get(...)` in edge functions (76 files) — no hardcoded credentials were found in a repository-wide sweep.
- `.env` in the repository root historically held only the (low-sensitivity, RLS-protected) Supabase anon/publishable key — it has been removed from git tracking and added to `.gitignore` (2026-08-10) as a hygiene improvement; local development now relies on `.env.local` (already gitignored via the `*.local` pattern).
- Production secrets are managed via `supabase secrets set` against the Supabase project directly, never committed to the repository.

## 6. Webhook authenticity verification

| Integration | Mechanism | File |
|---|---|---|
| Square (billing) | HMAC-SHA256 over `notificationUrl + rawBody`, verified against `x-square-hmacsha256-signature` | `supabase/functions/square-webhook/index.ts` |
| Quo / OpenPhone (dialer) | HMAC-SHA256, verified against the `openphone-signature` header | `supabase/functions/quo-webhook/index.ts` (documented as a public endpoint relying solely on signature verification, by design of the OpenPhone webhook model) |

## 7. Internal service-to-service authentication

Edge functions that call each other internally (rather than being invoked by an end user) authenticate via a shared `INTERNAL_FUNCTION_SECRET`, compared using a constant-time (`timingSafeEqual`) comparison to prevent timing attacks — used by `send-admin-email`, `portal-otp`, `pro-portal-otp`, `notify-portal-request`, `process-email-digest`, `engagement-message-send`, and `security-audit`. The raw Supabase service-role key is explicitly *not* accepted as a bearer token for this purpose.

## 8. Cross-origin request restrictions (CORS)

53 edge functions implement an explicit `ALLOWED_ORIGINS` allowlist (production domains only), reflecting the request origin only when it matches, and otherwise defaulting to the primary production origin. No function uses a wildcard (`*`) origin.

## 9. Encryption

- **In transit:** TLS/HTTPS is enforced platform-wide by Supabase and Firebase Hosting.
- **At rest:** Supabase's underlying Postgres database and Storage buckets are encrypted at rest at the platform level (Supabase/AWS infrastructure default).
- **Application-level:** there is currently no additional field-level encryption for sensitive columns (e.g. insurance policy numbers, financial figures) beyond the platform baseline above. `gen_random_bytes()` is used only to generate secure random tokens (portal sessions, share links), not to encrypt stored data.

## 10. Automated security monitoring

`supabase/functions/security-audit/index.ts` runs on a schedule and performs 7 automated self-tests:

1. RLS anonymous-isolation check
2. PII/SIN injection resistance on the AI assistant
3. AI data-residency check
4. Unauthenticated access lockdown on staff-only domains
5. CORS wildcard/reflection check
6. OTP brute-force timing/lockout check
7. AI "safety override" prompt-injection resistance

(An 8th test, third-party credential validity for the Asana PAT, was removed once the firm's task workflows moved off Asana onto the in-house `pm_tasks` system and the Asana subscription was downgraded — the check would otherwise generate a false-alarm failure email on every run once the old paid-tier token stopped validating.)

Results are logged to `security_audit_logs`; any failure creates a `staff_notifications` entry and triggers an email alert to `alerts@prosperwise.ca` via `send-admin-email`. Additional audit trails exist for governance actions (`sovereignty_audit_trail`) and Vault access (`vault_audit_log`).

## 11. Outbound PII filtering ("PII Shield")

Implementation: `supabase/functions/_shared/pii-shield.ts`, function `checkOutboundPii()`. A regex-based filter applied before certain outbound messages are sent, blocking:

- SIN (Social Insurance Number) patterns
- Account-number-like references
- Credit-card-length digit runs
- Phrases referencing balance/AUM/net worth alongside a dollar figure
- Any dollar amount ≥ $1,000
- Long (8+) digit runs
- A list of health-related terms (e.g. cancer, HIV, psychiatric conditions, named medications, dementia)

Wired into 5 outbound paths: `quo-service` (SMS), `portal-sms`, `send-admin-email` (Gmail), `engagement-message-send`, and the Wix email relay in `vault-service`.

**Important characterization:** this is a keyword/pattern filter, not comprehensive data-loss prevention. It can both over-block (any $1,000+ figure, even non-sensitive ones) and under-block (PII that doesn't match its specific patterns). It should be described as an additional safeguard, not a guarantee.

## 12. Personal & financial data collected

Category-level summary (not exhaustive column list) — see `supabase/migrations/` for full schema:

- **Contact information:** name, email, phone, address (`contacts`)
- **Household/family structure:** household membership, family relationships, total assets, fee tier (`families`, `households`)
- **Corporate/estate structures:** corporate shareholders and entities (`corporations`, `corporate_shareholders`)
- **Investment holdings:** account-level financial data (`vineyard_accounts`, `storehouses`)
- **Insurance:** carrier, policy number, coverage/cash value, premiums, named beneficiaries (`insurance_policies`)
- **Correspondence:** engagement messages, call recordings and transcripts, SMS content, portal request messages (`engagement_messages`, `quo_calls`, `quo_messages`, `portal_request_messages`)
- **Documents:** client-uploaded and firm-generated files, stored in Google Drive via the Vault, with Supabase Storage buckets for uploads (`statement-uploads`, `portal-uploads`, `cashflow-uploads`, `charter-source-uploads`, `brain-uploads`, `knowledge-base` — all private, non-public buckets)

## 13. Third-party data sharing (sub-processors)

| Provider | Data shared | Purpose | Notes |
|---|---|---|---|
| Google (Workspace) | Gmail (send transactional system email; read-only message metadata for the per-contact email history panel), Calendar (read-only), Drive access | Vault document storage, system notifications (OTP delivery, digests, alerts) sent from the firm's shared inbox, and a read-only "Email History" view on each contact's Communications tab | Access via OAuth (`google-auth`), tokens stored in `google_tokens`. There is no staff inbox client — email history is read-only and there is no in-app compose/reply |
| Square | Client name, email, invoice line items | Payment processing / invoicing | `square-service`, `square-webhook`. No card data touches ProsperWise's own systems — Square hosts the payment page |
| ~~Asana~~ | Client names (in task titles/notes where staff included them) | **Deprecated (2026-10).** All task workflows run in the in-house `pm_tasks` system; the Asana edge functions (`asana-service`, `asana-task-sync`, `pro-portal-tasks`, `asana-pm-backfill`, `asana-project-import`) and every UI/automation touchpoint were removed. Historical tasks and comments were backfilled into `pm_tasks`. | Removed. Remaining to-do outside code: revoke/unset the `ASANA_*` secrets and the PAT, cancel the account, and request deletion of retained data. | 
| Quo (OpenPhone) | Contact name, phone number, call recordings, transcripts, SMS content | Dialer / client communication | `quo-service`, `quo-webhook`. US-hosted infrastructure — this is the integration the PII Shield (§11) was originally built to protect |

**Known limitation:** there is currently no single documented sub-processor registry or confirmed Data Processing Agreement (DPA) list maintained within this repository. This mapping is derived from code, not from a legal/vendor-management source of truth — do not assume formal DPAs exist without confirming separately with each vendor.

## 14. Data retention & deletion

- No formal data retention policy, TTL, or scheduled expiry/deletion job exists today. The only scheduled (`pg_cron`) job in the codebase is unrelated (a search-index maintenance job).
- Deletion is manual: a staff member deleting a `contacts` row triggers `ON DELETE CASCADE` to dependent records (accounts, policies, etc.). There is no client-initiated or automatic deletion path.
- `merge-contacts` removes duplicate records after transferring their data to the surviving record.
- **No client-facing "delete my data" / data export mechanism exists in the portal today.**

## 15. Data residency

- **Confirmed 2026-08-10 via Supabase dashboard:** the production database (`rpxevcovasrgmrzkpknu`) runs in `ca-central-1` (Canada Central), status healthy. Not declared in repository code/config (`supabase/config.toml` only declares the project ID) — this is a platform-level (dashboard) setting, confirmed directly rather than inferred from code.
- One legacy cron migration references a different, older Supabase project ref (`skcgdoiestzqxsooaxur`) in a `net.http_post` call — this is a stale reference from before the Lovable-to-self-owned-infrastructure migration and should be reconciled or removed.
- **Google Workspace (Drive/Vault documents, Gmail, Calendar): data region is the United States** — confirmed in the Google Admin console by Rolf, 2026-10-09. Google offers only US, EU or "No preference" for Workspace data regions (support.google.com/a/answer/7630496); Canada is not an option. The Vault (Google Drive) therefore does not meet a Canadian-residency commitment. The privacy policy previously said the Workspace region was Canada (commit 401cf12, 2026-10-03) and was corrected 2026-10-09. Options to restore Canadian residency for client documents: move the Vault to Canadian object storage (Google Cloud Storage `northamerica-northeast1` or Supabase Storage `ca-central-1`).
- **Edge Function processing region (verified 2026-10-09):** Supabase Edge Functions run at the location nearest the caller unless an `x-region` header is sent. Before pinning, a call from Kelowna ran in `us-west-2` (`x-sb-edge-region` response header). Now pinned to `ca-central-1`: browser requests (`src/shared/lib/region-pin.ts`, installed first in `src/main.tsx`), function-to-function calls (each sets `"x-region": "ca-central-1"`), and the 8 `pg_cron`/`pg_net` jobs (migration `20261013130000`). Every function lists `x-region` in its CORS allowed headers. **Not pinnable:** inbound webhooks (Square, Quo, Google push, the CRM intake callback) and email open/click tracking requests, which the sending party calls at the nearest location; those handlers then write to the Canadian database. Preflight (OPTIONS) requests carry no client data and may be answered at any location. To re-verify: send a request with and without the header and compare `x-sb-edge-region`.
- Firebase Hosting (serving the frontend) does not declare a region in `firebase.json`; Firebase Hosting's CDN is global by default.

## 16. Backups

**Gap identified 2026-08-10:** the Supabase dashboard shows "No backups" configured for the production project. This is a real Availability-domain gap — there is currently no database backup/point-in-time-recovery in place. This should be treated as a priority item, not just a documentation nicety, since it affects actual data-loss risk, not only compliance posture.

## 17. AI processing (Vertex AI)

- **Region:** every Gemini call is pinned to `northamerica-northeast1` (Montréal) -- `REGION` in `supabase/functions/_shared/vertex-ai.ts` (and the same constant in the few functions that build their own request URL). No call uses a global endpoint.
- **Models (as of 2026-10-03):** all features run `gemini-3.5-flash`, the only 3.x model served from the Montréal region (the 3.1/3-flash variants return 404 there; the "-preview" variants are global-only and are deliberately not used because they would leave the Canadian region). Google retires Gemini 2.5 on 2027-03-31. Model choice lives in one place (`_shared/vertex-ai.ts`), in per-feature tiers, each with a function secret for an instant rollback to `gemini-2.5-flash`/`-pro` (`GEMINI_EXTRACT_MODEL`, `GEMINI_DRAFTING_MODEL`, `GEMINI_GOVERNANCE_MODEL`, `GEMINI_CLIENT_CHAT_MODEL`, `GEMINI_PRO_MODEL`, `GEORGIA_LLM_MODEL`, `SHOEBOX_CLASSIFY_MODEL`).
- **Data retention at Google:** Gemini 3.x enables "durable caching" by default (cached prompt data at rest up to 24h). The project-level cache setting was set to `EPHEMERAL` retention (`PATCH .../projects/gen-lang-client-0223396536/cacheConfig`, confirmed `done: true`, 2026-10), preserving the no-retention-at-rest posture that applied to 2.5.
- **Outbound PII controls** are unchanged by the model move: `_shared/pii-shield.ts` still gates the outbound paths listed in section 11 (the Delta Engine transcript path included); the free-text safety screen on the public Georgia diagnostic never sends raw text to the model for the acknowledgment paragraph (only fixed category facts).
- **Client-facing assistants** (portal Georgia, VFO concierge): output rules in `_shared/georgia-chat-config.ts`; on a red-team set the previous model dumped its instructions/knowledge base on request while 3.5 declined every time. Replies are still advisory-free by design and every AI-drafted record is staff-reviewed before it is used.

---

## Roadmap / planned improvements

These are known, deliberate gaps — listed here rather than silently omitted, so this document stays honest as a living reference:

1. **Formal data retention & deletion policy — retention period confirmed at 7 years from the end of the advisory relationship.** In progress: a staff-reviewed retention-monitoring mechanism (§16) that flags households past the 7-year floor for manual staff decision. Deletion is never automatic and is never triggered by a client request — see item 2.
2. **Client-facing self-service data request mechanism** in the portal. In progress: clients can request a *copy* of their data (see §14). Deletion is explicitly **not** offered as a client-initiated action — ProsperWise is required to retain client records for 7 years from relationship end regardless of any request, so there is no client-facing deletion path by design, now or planned.
3. ~~Role-based access control~~ / ~~household-scoped `portal-uploads` policy~~ — reclassified as deliberate design decisions, not gaps. See §1 and §2 above.
4. **Documented sub-processor / DPA registry** maintained outside of code, confirmed with each vendor (Google, Square, OpenPhone, Wix; Asana is deprecated). See `SUBPROCESSORS.md` (template drafted, vendor confirmation still needed — not something this document can self-certify).
5. **Reconcile the stale cron reference** to the old Supabase project ✅ **DONE** — `brain-index-drain`'s live schedule was pointed at the decommissioned project (`skcgdoiestzqxsooaxur`); fixed via a follow-up migration re-scheduling the job at the correct project URL, verified directly against `cron.job`.
6. **Enable database backups / point-in-time recovery** on the production Supabase project — currently none configured. Tracked separately (Asana), not part of this document's engineering scope. Highest-priority item on this list; this is an operational data-loss risk, not just a documentation gap.
