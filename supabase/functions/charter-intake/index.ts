// charter-intake — staff-only CRUD for the v2.0 Sovereignty Charter's
// "Foundational Bedrock" (Family Vision, Core Values, System Grounding
// Principles). Household-scoped, entirely separate from the v1
// contact-scoped sovereignty_charters table, which this function only
// ever reads from (for pre-fill), never writes to.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  computeActiveAssetRatio,
  computeSbdClawback,
  computeStorehouseFundedPct,
  computeVaultReadiness,
  gatherHouseholdFinancials,
  inferTrackType,
  VAULT_READINESS_SLUGS,
} from "../_shared/sovereignty-diagnostics.ts";
import { generateVertexContent, parseServiceAccountKey, type ServiceAccountKey } from "../_shared/vertex-ai.ts";
import { getServiceGoogleAccessToken } from "../_shared/google-token.ts";
import { driveDownloadFile, driveListChildren, matchVaultCategoryFolder } from "../_shared/vault-provisioning.ts";

const ALLOWED_ORIGINS = [
  "https://prosperwise-portal.web.app",
  "https://prosperwise.lovable.app",
  "https://app.prosperwise.ca",
  "https://id-preview--339dfc8f-3e82-4b05-8a36-a9f66fc58449.lovable.app",
];

function getCorsHeaders(req: Request) {
  const origin = req.headers.get("Origin") || "";
  const allowed =
    ALLOWED_ORIGINS.includes(origin) || origin.endsWith(".lovable.app") || origin.endsWith(".lovableproject.com")
      ? origin
      : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  };
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

function admin() {
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
}

async function requireStaff(req: Request): Promise<{ userId: string; error?: undefined } | { error: string }> {
  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader) return { error: "Missing authorization header" };
  const supabaseUser = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data, error } = await supabaseUser.auth.getUser();
  if (error || !data?.user) return { error: "Not authenticated" };
  if (!data.user.email?.endsWith("@prosperwise.ca")) return { error: "Not authorized" };
  return { userId: data.user.id };
}

interface NamedItem {
  key: string;
  title: string;
  description: string;
}

interface MeetingTranscript {
  id: string;
  title: string;
  content_text: string;
  added_at: string;
  external_file_id: string | null;
  external_modified_at: string | null;
}

interface LegalDocument {
  id: string;
  title: string;
  source_category: "estate" | "business";
  document_type: string;
  summary: string;
  extracted_facts: {
    testator_or_grantor_name: string | null;
    date_executed: string | null;
    jurisdiction: string | null;
    parties: { name: string; role: string; relationship: string | null }[];
    beneficiary_designations: { beneficiary_name: string; asset_or_share_description: string }[];
    key_clauses: { clause_ref: string | null; summary: string }[];
    notes: string | null;
  };
  external_file_id: string;
  external_modified_at: string | null;
  added_at: string;
}

interface NextGenMilestone {
  id: string;
  member_name: string;
  milestone_title: string;
  status: "not_started" | "in_progress" | "complete";
  target_date: string | null;
  notes: string | null;
}

const CORE_VALUES_DEFAULTS: NamedItem[] = [
  { key: "autonomy_respect", title: "Individual Autonomy and Mutual Respect", description: "" },
  { key: "radical_transparency", title: "Radical Transparency and Honest Communication", description: "" },
  { key: "contribution_before_consumption", title: "Contribution Before Consumption", description: "" },
  { key: "community_stewardship", title: "Community and Enduring Stewardship", description: "" },
];

const GROUNDING_PRINCIPLES_DEFAULTS: NamedItem[] = [
  { key: "separation", title: "Principle of Separation (Assets Serve the Mission)", description: "" },
  { key: "deceleration", title: "Principle of Deceleration (Equilibrium Over Impulse)", description: "" },
  { key: "fiduciary_alignment", title: "Principle of Fiduciary Alignment", description: "" },
  { key: "preparedness", title: "Principle of Preparedness", description: "" },
];

const CHARTER_FIELDS =
  "id, household_id, status, step, vision_text, core_values, grounding_principles, " +
  "treasury_snapshot, treasury_snapshot_computed_at, vineyard_replenishment_policy, river_boundary_note, " +
  "meeting_transcripts, discretionary_trust_guidelines, poa_incapacity_protocol, shareholder_voting_philosophy, " +
  "boundary_protocol_note, capital_request_framework_note, matrimonial_ringfencing_note, " +
  "legal_documents, governance_snapshot, governance_snapshot_computed_at, corporate_passive_income_annual, " +
  "active_operational_assets_value, cda_balance, tax_friction_shields_note, hub_spoke_cadence_note, " +
  "tri_party_mou_note, pure_fiduciary_standard_note, " +
  "identity_transition_note, next_gen_milestones, philanthropic_stewardship_note, " +
  "family_values_addendum_signed_at, family_values_addendum_reaffirmed_at, " +
  "completed_at, completed_by, created_by, created_at, updated_at";

function isNamedItemArray(value: unknown): value is NamedItem[] {
  return (
    Array.isArray(value) &&
    value.every(
      (v) =>
        v && typeof v === "object" && typeof (v as Record<string, unknown>).title === "string" && typeof (v as Record<string, unknown>).description === "string",
    )
  );
}

function isMeetingTranscriptArray(value: unknown): value is MeetingTranscript[] {
  return (
    Array.isArray(value) &&
    value.every((v) => {
      if (!v || typeof v !== "object") return false;
      const r = v as Record<string, unknown>;
      return (
        typeof r.id === "string" &&
        typeof r.title === "string" &&
        typeof r.content_text === "string" &&
        typeof r.added_at === "string"
      );
    })
  );
}

function isLegalDocumentArray(value: unknown): value is LegalDocument[] {
  return (
    Array.isArray(value) &&
    value.every((v) => {
      if (!v || typeof v !== "object") return false;
      const r = v as Record<string, unknown>;
      return (
        typeof r.id === "string" &&
        typeof r.title === "string" &&
        (r.source_category === "estate" || r.source_category === "business") &&
        typeof r.document_type === "string" &&
        typeof r.summary === "string" &&
        typeof r.added_at === "string"
      );
    })
  );
}

function isNextGenMilestoneArray(value: unknown): value is NextGenMilestone[] {
  return (
    Array.isArray(value) &&
    value.every((v) => {
      if (!v || typeof v !== "object") return false;
      const r = v as Record<string, unknown>;
      return (
        typeof r.id === "string" &&
        typeof r.member_name === "string" &&
        typeof r.milestone_title === "string" &&
        (r.status === "not_started" || r.status === "in_progress" || r.status === "complete")
      );
    })
  );
}

const MAX_TRANSCRIPT_CHARS = 20000;
const PDF_INLINE_MAX_BYTES = 18 * 1024 * 1024; // ~18 MB safe for inline base64
const MAX_LEGAL_PDF_BYTES = 15 * 1024 * 1024; // matches governance-audit-generate's own cap
const MAX_PDFS_PER_LEGAL_FOLDER = 5; // matches governance-audit-generate's own cap

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

async function extractPdfTextWithVertex(sa: ServiceAccountKey, base64: string, fileName: string): Promise<string> {
  const result = await generateVertexContent(
    sa,
    "gemini-2.5-flash",
    [
      {
        role: "user",
        parts: [
          {
            text: `Extract the full readable text from this PDF document titled "${fileName}". Preserve headings, lists, and paragraph structure using plain text formatting. Do not summarize, do not add commentary, and do not wrap the output in code fences. Return only the extracted text.`,
          },
          { inlineData: { mimeType: "application/pdf", data: base64 } },
        ],
      },
    ],
    { temperature: 0.1, maxOutputTokens: 8192 },
  );
  const text = result.candidates?.[0]?.content?.parts?.[0]?.text || "";
  return text.trim();
}

/** Downloads and extracts plain text from a Drive file — Google Doc via /export, PDF via Vertex, anything else as raw text. */
async function extractDriveFileText(
  accessToken: string,
  sa: ServiceAccountKey,
  fileId: string,
  mimeType: string,
  fileName: string,
): Promise<string> {
  if (mimeType.startsWith("application/vnd.google-apps")) {
    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text/plain`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new Error(`Drive export failed [${res.status}]: ${(await res.text()).slice(0, 300)}`);
    return (await res.text()).slice(0, MAX_TRANSCRIPT_CHARS);
  }
  if (mimeType.includes("pdf")) {
    const buffer = await driveDownloadFile(fileId, accessToken);
    if (buffer.byteLength > PDF_INLINE_MAX_BYTES) {
      throw new Error(`PDF too large to extract inline (${Math.round(buffer.byteLength / 1024 / 1024)} MB)`);
    }
    const text = await extractPdfTextWithVertex(sa, arrayBufferToBase64(buffer), fileName);
    if (!text.trim()) throw new Error("PDF extraction returned no usable text");
    return text.slice(0, MAX_TRANSCRIPT_CHARS);
  }
  const buffer = await driveDownloadFile(fileId, accessToken);
  return new TextDecoder().decode(buffer).slice(0, MAX_TRANSCRIPT_CHARS);
}

// ---------- Legal document extraction (wills/POA/trust deeds, shareholder agreements) ----------
// Clones governance-audit-generate/index.ts's LEGAL_FACTS_TOOL_SCHEMA/LEGAL_PROMPT pattern,
// persisted here (that function's own extraction stays ephemeral, JSONB on one audit row) and
// extended to also cover the "business" Vault category (shareholder agreements/minute books),
// which governance-audit-generate never touches.

const ESTATE_LEGAL_PROMPT = `The attached PDF is (or may be) a Will or other legal/estate document (it may be a \
scanned image with no text layer -- read it visually page by page; Wills are often 5-10 pages).

Transcribe it into the given schema. In particular:
- parties: executor(s)/trustee(s) (including named alternates and the conditions that trigger them), \
powers of attorney, and any other named role-holders.
- beneficiary_designations: who receives what, as directed by the document.
- key_clauses: any clause that creates a specific right, restriction, or condition worth an advisor's \
attention for financial/estate planning purposes (e.g. a spousal life interest in the home, a trust \
condition, a specific bequest) -- reference the clause number if the document numbers its clauses, and \
describe factually what it does, not why it matters.
- summary: 2-4 plain-language sentences describing what this document is and its key terms, for a wealth \
advisor's quick reference.

If this document is clearly NOT a Will/legal/estate document, still call the function, but set \
document_type to "NOT_APPLICABLE" and leave every other field null/empty (summary may briefly note what \
the document actually appears to be).`;

const BUSINESS_LEGAL_PROMPT = `The attached PDF is (or may be) a shareholder agreement, corporate minute \
book excerpt, or similar corporate-governance document (it may be a scanned image with no text layer -- \
read it visually page by page).

Transcribe it into the given schema. In particular:
- parties: shareholders/directors named in the document, with their role (e.g. "Shareholder", "Director") \
and, where stated, their ownership percentage or share class (fold this into the relationship field).
- beneficiary_designations: usually not applicable for this document type -- leave empty unless the \
document genuinely designates a beneficiary of something (e.g. a buy-sell insurance-funded payout).
- key_clauses: buy-sell triggers, valuation methodology, share-transfer restrictions, drag-along/tag-along \
rights, non-compete/non-solicit terms, or any other clause materially affecting how shares can move or be \
valued -- reference the clause number if numbered, describe factually what it does.
- summary: 2-4 plain-language sentences describing what this document is and its key terms, for a wealth \
advisor's quick reference.

If this document is clearly NOT a shareholder agreement or corporate-governance document, still call the \
function, but set document_type to "NOT_APPLICABLE" and leave every other field null/empty (summary may \
briefly note what the document actually appears to be).`;

const LEGAL_DOC_TOOL_SCHEMA = {
  functionDeclarations: [
    {
      name: "extract_legal_document",
      description: "Extract structured facts from a legal/estate or corporate-governance document PDF.",
      parameters: {
        type: "OBJECT",
        properties: {
          document_type: {
            type: "STRING",
            description: '"Will", "Power of Attorney", "Trust Indenture", "Shareholder Agreement", "Corporate Minute Book Excerpt", etc., or "NOT_APPLICABLE".',
          },
          summary: { type: "STRING", description: "2-4 plain-language sentences for a wealth advisor's quick reference." },
          testator_or_grantor_name: { type: "STRING" },
          date_executed: { type: "STRING", description: "ISO date if determinable, else free text (e.g. \"April 2025\")." },
          jurisdiction: { type: "STRING", description: 'e.g. "British Columbia".' },
          parties: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                name: { type: "STRING" },
                role: { type: "STRING" },
                relationship: { type: "STRING" },
              },
              required: ["name", "role"],
            },
          },
          beneficiary_designations: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                beneficiary_name: { type: "STRING" },
                asset_or_share_description: { type: "STRING" },
              },
              required: ["beneficiary_name", "asset_or_share_description"],
            },
          },
          key_clauses: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                clause_ref: { type: "STRING" },
                summary: { type: "STRING", description: "Plain-language, factual summary of what the clause does." },
              },
              required: ["summary"],
            },
          },
          notes: { type: "STRING" },
        },
        required: ["document_type", "summary"],
      },
    },
  ],
};

async function extractLegalDocFacts(
  sa: ServiceAccountKey,
  prompt: string,
  pdfBytes: ArrayBuffer,
  // deno-lint-ignore no-explicit-any
): Promise<Record<string, any>> {
  const result = await generateVertexContent(
    sa,
    "gemini-2.5-flash",
    [{ role: "user", parts: [{ text: prompt }, { inlineData: { mimeType: "application/pdf", data: arrayBufferToBase64(pdfBytes) } }] }],
    { temperature: 0, maxOutputTokens: 4096 },
    { tools: [LEGAL_DOC_TOOL_SCHEMA], toolConfig: { functionCallingConfig: { mode: "ANY", allowedFunctionNames: ["extract_legal_document"] } } },
  );
  const parts = result.candidates?.[0]?.content?.parts || [];
  // deno-lint-ignore no-explicit-any
  const fnCall = parts.find((p: any) => p.functionCall)?.functionCall;
  return fnCall?.args || {};
}

/** Resolves the Drive folder id of a household's Advisor Files > Meeting Notes subfolder, or null if either is missing. */
// deno-lint-ignore no-explicit-any
async function resolveMeetingNotesFolderId(db: any, householdId: string, accessToken: string): Promise<string | null> {
  const { data: household } = await db
    .from("households")
    .select("vault_root_folder_id")
    .eq("id", householdId)
    .maybeSingle();
  const vaultRootFolderId = household?.vault_root_folder_id as string | undefined;
  if (!vaultRootFolderId) return null;

  // vault_root_folder_id's own parent is the "[LastName] Household" folder,
  // which "Advisor Files" is a sibling of (see vault-provisioning.ts's own
  // header comment for the exact tree shape).
  const metaRes = await fetch(
    `https://www.googleapis.com/drive/v3/files/${vaultRootFolderId}?fields=parents`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!metaRes.ok) return null;
  const meta = await metaRes.json();
  const householdFolderId = meta.parents?.[0];
  if (!householdFolderId) return null;

  const householdChildren = await driveListChildren(householdFolderId, accessToken);
  const advisorFolder = householdChildren.find(
    (f) => f.mimeType === "application/vnd.google-apps.folder" && f.name === "Advisor Files",
  );
  if (!advisorFolder) return null;

  const advisorChildren = await driveListChildren(advisorFolder.id, accessToken);
  const meetingNotesFolder = advisorChildren.find(
    (f) => f.mimeType === "application/vnd.google-apps.folder" && f.name === "Meeting Notes",
  );
  return meetingNotesFolder?.id ?? null;
}

// deno-lint-ignore no-explicit-any
async function loadV1Prefill(db: any, householdId: string): Promise<{ available: boolean; suggestedVisionText: string }> {
  const { data: contacts } = await db.from("contacts").select("id").eq("household_id", householdId);
  const contactIds = (contacts || []).map((c: { id: string }) => c.id);
  if (contactIds.length === 0) return { available: false, suggestedVisionText: "" };

  const { data: charters } = await db
    .from("sovereignty_charters")
    .select("contact_id, mission_of_capital, vision_20_year, draft_status, esign_status, ratified_at")
    .in("contact_id", contactIds);

  const qualifying = (charters || []).filter(
    (c: { draft_status: string | null; esign_status: string | null }) =>
      c.draft_status === "ratified" || c.draft_status === "generated" || c.esign_status === "ratified",
  );
  if (qualifying.length === 0) return { available: false, suggestedVisionText: "" };

  // Prefer a ratified charter over a merely-generated one; among ties, the
  // most recently ratified. Neither field is required to be non-null.
  qualifying.sort((a: { draft_status: string | null; esign_status: string | null; ratified_at: string | null }, b: typeof a) => {
    const aRatified = a.draft_status === "ratified" || a.esign_status === "ratified" ? 1 : 0;
    const bRatified = b.draft_status === "ratified" || b.esign_status === "ratified" ? 1 : 0;
    if (aRatified !== bRatified) return bRatified - aRatified;
    return (b.ratified_at || "").localeCompare(a.ratified_at || "");
  });
  const chosen = qualifying[0] as { mission_of_capital: string | null; vision_20_year: string | null };
  const parts = [chosen.mission_of_capital, chosen.vision_20_year].filter((t) => t && t.trim());
  if (parts.length === 0) return { available: false, suggestedVisionText: "" };
  return { available: true, suggestedVisionText: parts.join("\n\n") };
}

/** Always computed live from the real shareholder rows — never persisted as a column, so it can
 *  never drift stale while a household's corporate structure changes mid-wizard. */
// deno-lint-ignore no-explicit-any
async function resolveTrackType(db: any, householdId: string): Promise<"personal" | "corporate"> {
  const { data: contacts } = await db.from("contacts").select("id").eq("household_id", householdId);
  const contactIds = (contacts || []).map((c: { id: string }) => c.id);
  if (contactIds.length === 0) return "personal";
  const { data: shareholders } = await db
    .from("shareholders")
    .select("corporation_id")
    .in("contact_id", contactIds)
    .eq("is_active", true);
  return inferTrackType(shareholders || []);
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, "Content-Type": "application/json" },
    });

  try {
    const auth = await requireStaff(req);
    if (auth.error) return json({ ok: false, error: auth.error }, 401);
    const userId = auth.userId;

    const db = admin();
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "");
    const householdId = String(body?.household_id || "");
    if (!householdId) return json({ ok: false, error: "household_id is required" }, 400);

    if (action === "load") {
      let { data: charter, error } = await db
        .from("household_charters")
        .select(CHARTER_FIELDS)
        .eq("household_id", householdId)
        .maybeSingle();
      if (error) return json({ ok: false, error: error.message }, 500);

      if (!charter) {
        const { data: created, error: insertErr } = await db
          .from("household_charters")
          .insert({
            household_id: householdId,
            core_values: CORE_VALUES_DEFAULTS,
            grounding_principles: GROUNDING_PRINCIPLES_DEFAULTS,
            created_by: userId,
          })
          .select(CHARTER_FIELDS)
          .maybeSingle();
        if (insertErr) return json({ ok: false, error: insertErr.message }, 500);
        charter = created;
      }

      const prefill = await loadV1Prefill(db, householdId);
      const trackType = await resolveTrackType(db, householdId);
      return json({ ok: true, charter, prefill, track_type: trackType });
    }

    if (action === "save") {
      const { field, value, advance_to } = body;
      const columnByField: Record<string, string> = {
        vision: "vision_text",
        core_values: "core_values",
        grounding_principles: "grounding_principles",
        vineyard_replenishment: "vineyard_replenishment_policy",
        river_boundary: "river_boundary_note",
        meeting_transcripts: "meeting_transcripts",
        discretionary_trust_guidelines: "discretionary_trust_guidelines",
        poa_incapacity_protocol: "poa_incapacity_protocol",
        shareholder_voting_philosophy: "shareholder_voting_philosophy",
        boundary_protocol_note: "boundary_protocol_note",
        capital_request_framework_note: "capital_request_framework_note",
        matrimonial_ringfencing_note: "matrimonial_ringfencing_note",
        legal_documents: "legal_documents",
        corporate_passive_income_annual: "corporate_passive_income_annual",
        active_operational_assets_value: "active_operational_assets_value",
        cda_balance: "cda_balance",
        tax_friction_shields_note: "tax_friction_shields_note",
        hub_spoke_cadence_note: "hub_spoke_cadence_note",
        tri_party_mou_note: "tri_party_mou_note",
        pure_fiduciary_standard_note: "pure_fiduciary_standard_note",
        identity_transition_note: "identity_transition_note",
        next_gen_milestones: "next_gen_milestones",
        philanthropic_stewardship_note: "philanthropic_stewardship_note",
      };
      const column = columnByField[String(field || "")];
      if (!column) return json({ ok: false, error: "Unknown field" }, 400);

      const TEXT_COLUMNS = new Set([
        "vision_text",
        "vineyard_replenishment_policy",
        "river_boundary_note",
        "discretionary_trust_guidelines",
        "poa_incapacity_protocol",
        "shareholder_voting_philosophy",
        "boundary_protocol_note",
        "capital_request_framework_note",
        "matrimonial_ringfencing_note",
        "tax_friction_shields_note",
        "hub_spoke_cadence_note",
        "tri_party_mou_note",
        "pure_fiduciary_standard_note",
        "identity_transition_note",
        "philanthropic_stewardship_note",
      ]);
      const NUMBER_COLUMNS = new Set(["corporate_passive_income_annual", "active_operational_assets_value", "cda_balance"]);
      if (NUMBER_COLUMNS.has(column)) {
        if (value !== null && typeof value !== "number") return json({ ok: false, error: "Expected a number" }, 400);
      } else if (TEXT_COLUMNS.has(column)) {
        if (typeof value !== "string") return json({ ok: false, error: "Expected a text value" }, 400);
      } else if (column === "meeting_transcripts") {
        if (!isMeetingTranscriptArray(value)) {
          return json({ ok: false, error: "Expected an array of {id, title, content_text, added_at}" }, 400);
        }
      } else if (column === "legal_documents") {
        if (!isLegalDocumentArray(value)) {
          return json({ ok: false, error: "Expected an array of {id, title, source_category, document_type, summary, added_at}" }, 400);
        }
      } else if (column === "next_gen_milestones") {
        if (!isNextGenMilestoneArray(value)) {
          return json({ ok: false, error: "Expected an array of {id, member_name, milestone_title, status}" }, 400);
        }
      } else if (!isNamedItemArray(value)) {
        return json({ ok: false, error: "Expected an array of {key, title, description}" }, 400);
      }

      const { data: current, error: currentErr } = await db
        .from("household_charters")
        .select("step")
        .eq("household_id", householdId)
        .maybeSingle();
      if (currentErr) return json({ ok: false, error: currentErr.message }, 500);
      if (!current) return json({ ok: false, error: "No charter record for this household — call load first" }, 404);

      const nextStep = Math.max(current.step, Number(advance_to) || current.step);
      const { data, error } = await db
        .from("household_charters")
        .update({ [column]: value, step: nextStep })
        .eq("household_id", householdId)
        .select(CHARTER_FIELDS)
        .maybeSingle();
      if (error) return json({ ok: false, error: error.message }, 500);
      return json({ ok: true, charter: data });
    }

    if (action === "recompute_treasury") {
      const financials = await gatherHouseholdFinancials(db, householdId);
      const { targets, fundedPct } = computeStorehouseFundedPct(financials.storehouses, financials.storehouseReserves);

      const snapshot = {
        aum: financials.totalAum,
        net_worth: financials.netWorth,
        vineyard_total: financials.totalVineyard,
        holding_tank_total: financials.totalHoldingTank,
        personal_liabilities_total: financials.totalPersonalLiabilities,
        corp_liabilities_total: financials.totalCorpLiabilities,
        storehouse_reserves: financials.storehouseReserves,
        storehouse_targets: targets,
        storehouse_funded_pct: fundedPct,
        // deno-lint-ignore no-explicit-any
        holding_tank_rows: financials.holdingTank.map((h: any) => ({
          id: h.id,
          account_name: h.account_name,
          current_value: Number(h.current_value) || 0,
          days_since_added: Math.floor((Date.now() - new Date(h.created_at).getTime()) / 86_400_000),
        })),
      };

      const { data, error } = await db
        .from("household_charters")
        .update({ treasury_snapshot: snapshot, treasury_snapshot_computed_at: new Date().toISOString() })
        .eq("household_id", householdId)
        .select(CHARTER_FIELDS)
        .maybeSingle();
      if (error) return json({ ok: false, error: error.message }, 500);
      if (!data) return json({ ok: false, error: "No charter record for this household — call load first" }, 404);
      return json({ ok: true, charter: data });
    }

    if (action === "sync_meeting_transcripts") {
      let accessToken: string;
      try {
        accessToken = await getServiceGoogleAccessToken(db);
      } catch (e) {
        return json({ ok: false, error: `Google auth failed: ${e instanceof Error ? e.message : String(e)}` }, 500);
      }

      const meetingNotesFolderId = await resolveMeetingNotesFolderId(db, householdId, accessToken);
      if (!meetingNotesFolderId) {
        return json({ ok: true, synced: 0, folder_missing: true });
      }

      const files = (await driveListChildren(meetingNotesFolderId, accessToken)).filter(
        (f) => f.mimeType !== "application/vnd.google-apps.folder",
      );

      const { data: current, error: currentErr } = await db
        .from("household_charters")
        .select("meeting_transcripts")
        .eq("household_id", householdId)
        .maybeSingle();
      if (currentErr) return json({ ok: false, error: currentErr.message }, 500);
      if (!current) return json({ ok: false, error: "No charter record for this household — call load first" }, 404);

      const existing: MeetingTranscript[] = current.meeting_transcripts || [];
      const byFileId = new Map(existing.filter((t) => t.external_file_id).map((t) => [t.external_file_id, t]));
      const resultArray: MeetingTranscript[] = [...existing];
      const errors: { title: string; message: string }[] = [];
      let synced = 0;
      let sa: ServiceAccountKey | null = null;

      for (const file of files as { id: string; name: string; mimeType: string; modifiedTime?: string }[]) {
        const prior = byFileId.get(file.id);
        if (prior && prior.external_modified_at === file.modifiedTime) continue;

        try {
          if (file.mimeType.includes("pdf") && !sa) {
            sa = await parseServiceAccountKey(Deno.env.get("GCP_SERVICE_ACCOUNT_KEY"));
          }
          const contentText = await extractDriveFileText(
            accessToken,
            sa as ServiceAccountKey,
            file.id,
            file.mimeType,
            file.name,
          );
          const entry: MeetingTranscript = {
            id: prior?.id ?? crypto.randomUUID(),
            title: file.name,
            content_text: contentText,
            added_at: new Date().toISOString(),
            external_file_id: file.id,
            external_modified_at: file.modifiedTime ?? null,
          };
          const idx = resultArray.findIndex((t) => t.external_file_id === file.id);
          if (idx >= 0) resultArray[idx] = entry;
          else resultArray.push(entry);
          synced++;
        } catch (e) {
          errors.push({ title: file.name, message: e instanceof Error ? e.message : String(e) });
        }
      }

      const { data, error } = await db
        .from("household_charters")
        .update({ meeting_transcripts: resultArray })
        .eq("household_id", householdId)
        .select(CHARTER_FIELDS)
        .maybeSingle();
      if (error) return json({ ok: false, error: error.message }, 500);
      return json({ ok: true, charter: data, synced, errors });
    }

    if (action === "sync_legal_documents") {
      const { data: household } = await db
        .from("households")
        .select("vault_root_folder_id")
        .eq("id", householdId)
        .maybeSingle();
      const vaultRootFolderId = household?.vault_root_folder_id as string | undefined;
      if (!vaultRootFolderId) {
        return json({ ok: true, synced: 0, vault_missing: true });
      }

      let accessToken: string;
      try {
        accessToken = await getServiceGoogleAccessToken(db);
      } catch (e) {
        return json({ ok: false, error: `Google auth failed: ${e instanceof Error ? e.message : String(e)}` }, 500);
      }

      const rootChildren = await driveListChildren(vaultRootFolderId, accessToken);
      const { data: templates } = await db
        .from("vault_folder_templates")
        .select("display_name, slug")
        .eq("is_active", true)
        .in("slug", ["estate", "business"]);
      const categoryByslug = new Map((templates || []).map((t: { slug: string; display_name: string }) => [t.slug, t.display_name]));

      const { data: current, error: currentErr } = await db
        .from("household_charters")
        .select("legal_documents")
        .eq("household_id", householdId)
        .maybeSingle();
      if (currentErr) return json({ ok: false, error: currentErr.message }, 500);
      if (!current) return json({ ok: false, error: "No charter record for this household — call load first" }, 404);

      const existing: LegalDocument[] = current.legal_documents || [];
      const byFileId = new Map(existing.map((d) => [d.external_file_id, d]));
      const resultArray: LegalDocument[] = [...existing];
      const errors: { title: string; message: string }[] = [];
      let synced = 0;
      let sa: ServiceAccountKey | null = null;

      const categories: { slug: "estate" | "business"; prompt: string }[] = [
        { slug: "estate", prompt: ESTATE_LEGAL_PROMPT },
        { slug: "business", prompt: BUSINESS_LEGAL_PROMPT },
      ];

      for (const cat of categories) {
        const displayName = categoryByslug.get(cat.slug);
        if (!displayName) continue;
        const folder = matchVaultCategoryFolder(rootChildren, displayName);
        if (!folder) continue;

        const pdfs = (await driveListChildren(folder.id, accessToken))
          .filter((f) => f.mimeType === "application/pdf")
          .slice(0, MAX_PDFS_PER_LEGAL_FOLDER) as { id: string; name: string; mimeType: string; modifiedTime?: string }[];

        for (const pdf of pdfs) {
          const prior = byFileId.get(pdf.id);
          if (prior && prior.external_modified_at === pdf.modifiedTime) continue;

          try {
            const buffer = await driveDownloadFile(pdf.id, accessToken);
            if (buffer.byteLength > MAX_LEGAL_PDF_BYTES) {
              errors.push({ title: pdf.name, message: `Skipped, larger than ${MAX_LEGAL_PDF_BYTES / (1024 * 1024)}MB` });
              continue;
            }
            if (!sa) sa = await parseServiceAccountKey(Deno.env.get("GCP_SERVICE_ACCOUNT_KEY"));
            const facts = await extractLegalDocFacts(sa, cat.prompt, buffer);
            const documentType = String(facts.document_type || "");
            if (!documentType || documentType === "NOT_APPLICABLE") continue;

            const entry: LegalDocument = {
              id: prior?.id ?? crypto.randomUUID(),
              title: pdf.name,
              source_category: cat.slug,
              document_type: documentType,
              summary: String(facts.summary || ""),
              extracted_facts: {
                testator_or_grantor_name: facts.testator_or_grantor_name ?? null,
                date_executed: facts.date_executed ?? null,
                jurisdiction: facts.jurisdiction ?? null,
                parties: facts.parties ?? [],
                beneficiary_designations: facts.beneficiary_designations ?? [],
                key_clauses: facts.key_clauses ?? [],
                notes: facts.notes ?? null,
              },
              external_file_id: pdf.id,
              external_modified_at: pdf.modifiedTime ?? null,
              added_at: new Date().toISOString(),
            };
            const idx = resultArray.findIndex((d) => d.external_file_id === pdf.id);
            if (idx >= 0) resultArray[idx] = entry;
            else resultArray.push(entry);
            synced++;
          } catch (e) {
            errors.push({ title: pdf.name, message: e instanceof Error ? e.message : String(e) });
          }
        }
      }

      const { data, error } = await db
        .from("household_charters")
        .update({ legal_documents: resultArray })
        .eq("household_id", householdId)
        .select(CHARTER_FIELDS)
        .maybeSingle();
      if (error) return json({ ok: false, error: error.message }, 500);
      return json({ ok: true, charter: data, synced, errors });
    }

    if (action === "recompute_governance_snapshot") {
      const financials = await gatherHouseholdFinancials(db, householdId);
      const trackType = inferTrackType(financials.shareholders);
      const vaultProtocolReadiness = await computeVaultReadiness(
        db,
        financials.vaultRootFolderId,
        trackType === "corporate" ? [...VAULT_READINESS_SLUGS, "business"] : undefined,
      );

      // deno-lint-ignore no-explicit-any
      let taxShields: Record<string, any> | null = null;
      if (trackType === "corporate") {
        const { data: current } = await db
          .from("household_charters")
          .select("corporate_passive_income_annual, active_operational_assets_value, cda_balance")
          .eq("household_id", householdId)
          .maybeSingle();
        const passiveIncome = Number(current?.corporate_passive_income_annual) || 0;
        const activeAssets = Number(current?.active_operational_assets_value) || 0;
        taxShields = {
          sbd_clawback: computeSbdClawback(passiveIncome),
          active_asset_ratio: computeActiveAssetRatio(activeAssets, financials.totalCorpAssets),
          total_corp_assets: financials.totalCorpAssets,
          cda_balance: current?.cda_balance ?? null,
        };
      }

      const snapshot = { track_type: trackType, vault_protocol_readiness: vaultProtocolReadiness, tax_shields: taxShields };

      const { data, error } = await db
        .from("household_charters")
        .update({ governance_snapshot: snapshot, governance_snapshot_computed_at: new Date().toISOString() })
        .eq("household_id", householdId)
        .select(CHARTER_FIELDS)
        .maybeSingle();
      if (error) return json({ ok: false, error: error.message }, 500);
      if (!data) return json({ ok: false, error: "No charter record for this household — call load first" }, 404);
      return json({ ok: true, charter: data });
    }

    if (action === "draft_perspective_2") {
      const { data: charter, error: charterErr } = await db
        .from("household_charters")
        .select("vision_text, core_values, grounding_principles, meeting_transcripts")
        .eq("household_id", householdId)
        .maybeSingle();
      if (charterErr) return json({ ok: false, error: charterErr.message }, 500);
      if (!charter) return json({ ok: false, error: "No charter record for this household — call load first" }, 404);

      const { data: contacts } = await db
        .from("contacts")
        .select(
          "first_name, last_name, lawyer_name, lawyer_firm, accountant_name, accountant_firm, executor_name, executor_firm, poa_name, poa_firm",
        )
        .eq("household_id", householdId);

      const fiduciaryLines: string[] = [];
      for (const c of contacts || []) {
        const name = `${c.first_name} ${c.last_name || ""}`.trim();
        const roles: [string, string | null, string | null][] = [
          ["Lawyer", c.lawyer_name, c.lawyer_firm],
          ["Accountant", c.accountant_name, c.accountant_firm],
          ["Executor", c.executor_name, c.executor_firm],
          ["Power of Attorney", c.poa_name, c.poa_firm],
        ];
        for (const [role, roleName, firm] of roles) {
          if (roleName) fiduciaryLines.push(`${name}'s ${role}: ${roleName}${firm ? ` (${firm})` : ""}`);
        }
      }

      const values = (charter.core_values || []).map((v: NamedItem) => `${v.title}: ${v.description}`).join("\n");
      const principles = (charter.grounding_principles || [])
        .map((p: NamedItem) => `${p.title}: ${p.description}`)
        .join("\n");
      const transcripts = (charter.meeting_transcripts || [])
        .map((t: MeetingTranscript) => `--- ${t.title} ---\n${t.content_text}`)
        .join("\n\n");

      const prompt = `You are drafting the "Family Well-Being & Stakeholder Harmony" perspective of a household's Sovereignty Charter for a wealth advisory firm.

Family Vision:
${charter.vision_text || "(not yet written)"}

Core Values:
${values || "(none)"}

System Grounding Principles:
${principles || "(none)"}

Fiduciary contacts on file:
${fiduciaryLines.join("\n") || "(none on file)"}

Meeting transcripts:
${transcripts || "(none synced yet)"}

Draft the following six narratives, grounded strictly in the facts above — never invent a name, firm, amount, or fact not present in the supplied material. If the supplied material doesn't support a confident draft for a given field, write a short honest placeholder noting what's missing (e.g. "No meeting transcript content yet addresses this — revisit once a transcript covering trust guidelines is synced.") rather than fabricating detail:
1. Discretionary Trust Guidelines
2. POA & Incapacity Protocol
3. Shareholder Voting & Succession Philosophy
4. The Sovereignty Boundary Protocol (social/family boundary scripts)
5. Capital Request Framework
6. Matrimonial & Asset Ring-Fencing`;

      const DRAFT_TOOL_SCHEMA = {
        functionDeclarations: [
          {
            name: "draft_perspective_2_narratives",
            description: "Draft the six Family Well-Being & Stakeholder Harmony narratives.",
            parameters: {
              type: "OBJECT",
              properties: {
                discretionary_trust_guidelines: { type: "STRING" },
                poa_incapacity_protocol: { type: "STRING" },
                shareholder_voting_philosophy: { type: "STRING" },
                boundary_protocol_note: { type: "STRING" },
                capital_request_framework_note: { type: "STRING" },
                matrimonial_ringfencing_note: { type: "STRING" },
              },
              required: [
                "discretionary_trust_guidelines",
                "poa_incapacity_protocol",
                "shareholder_voting_philosophy",
                "boundary_protocol_note",
                "capital_request_framework_note",
                "matrimonial_ringfencing_note",
              ],
            },
          },
        ],
      };

      let sa: ServiceAccountKey;
      try {
        sa = await parseServiceAccountKey(Deno.env.get("GCP_SERVICE_ACCOUNT_KEY"));
      } catch (e) {
        return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
      }

      let result;
      try {
        result = await generateVertexContent(
          sa,
          "gemini-2.5-flash",
          [{ role: "user", parts: [{ text: prompt }] }],
          { temperature: 0.4, maxOutputTokens: 4096 },
          {
            tools: [DRAFT_TOOL_SCHEMA],
            toolConfig: { functionCallingConfig: { mode: "ANY", allowedFunctionNames: ["draft_perspective_2_narratives"] } },
          },
        );
      } catch (e) {
        return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
      }

      const parts = result.candidates?.[0]?.content?.parts || [];
      // deno-lint-ignore no-explicit-any
      const fnCall = parts.find((p: any) => p.functionCall)?.functionCall;
      if (!fnCall?.args) return json({ ok: false, error: "The model did not return a usable draft." }, 500);

      return json({ ok: true, draft: fnCall.args });
    }

    if (action === "draft_perspective_3") {
      const { data: charter, error: charterErr } = await db
        .from("household_charters")
        .select("vision_text, core_values, grounding_principles, meeting_transcripts, legal_documents")
        .eq("household_id", householdId)
        .maybeSingle();
      if (charterErr) return json({ ok: false, error: charterErr.message }, 500);
      if (!charter) return json({ ok: false, error: "No charter record for this household — call load first" }, 404);

      // service_tier lives on families (a family-grouping concept, per
      // service-tiering.ts), not households -- join through household_id.
      const { data: household } = await db
        .from("households")
        .select("family_id")
        .eq("id", householdId)
        .maybeSingle();
      let serviceTier: string | null = null;
      if (household?.family_id) {
        const { data: family } = await db.from("families").select("service_tier").eq("id", household.family_id).maybeSingle();
        serviceTier = family?.service_tier ?? null;
      }

      // Mirrors src/shared/lib/serviceTier.ts's SERVICE_TIER_CADENCE exactly --
      // keep both in sync if the tier cadence copy ever changes. Duplicated
      // rather than imported because Deno edge functions can't import from src/.
      const SERVICE_TIER_CADENCE_TEXT: Record<string, string> = {
        tier_0: "No scheduled review — $249 CAD ad-hoc",
        tier_1: "1 annual review — $249 CAD ad-hoc",
        tier_2a: "2 semi-annual reviews (Governance + Planning)",
        tier_2b: "2 semi-annual reviews (Allocation + Review)",
        tier_3: "Semi-annual or 3 seasonal sessions",
        tier_4: "4 Quarterly Strategic Audit Meetings",
      };

      const values = (charter.core_values || []).map((v: NamedItem) => `${v.title}: ${v.description}`).join("\n");
      const principles = (charter.grounding_principles || [])
        .map((p: NamedItem) => `${p.title}: ${p.description}`)
        .join("\n");
      const transcripts = (charter.meeting_transcripts || [])
        .map((t: MeetingTranscript) => `--- ${t.title} ---\n${t.content_text}`)
        .join("\n\n");
      const legalDocs = (charter.legal_documents || [])
        .map((d: LegalDocument) => `--- [${d.source_category}] ${d.document_type} — ${d.title} ---\n${d.summary}`)
        .join("\n\n");
      const cadenceText = serviceTier ? SERVICE_TIER_CADENCE_TEXT[serviceTier] ?? "(unrecognized tier)" : "(service tier not yet set)";

      const prompt = `You are drafting the "Operating Governance & Spoke Orchestration" perspective of a household's Sovereignty Charter for a wealth advisory firm.

Family Vision:
${charter.vision_text || "(not yet written)"}

Core Values:
${values || "(none)"}

System Grounding Principles:
${principles || "(none)"}

Meeting transcripts:
${transcripts || "(none synced yet)"}

Legal documents on file:
${legalDocs || "(none synced yet)"}

This household's service tier cadence: ${cadenceText}

Draft the following four narratives, grounded strictly in the facts above — never invent a name, firm, amount, or fact not present in the supplied material. If the supplied material doesn't support a confident draft for a given field, write a short honest placeholder noting what's missing rather than fabricating detail:
1. Hub-and-Spoke Coordination Cadence (reference the real service tier cadence given above)
2. Tri-Party MOU Protocol (CPA/estate-litigator coordination, zero liability overlap)
3. Pure Fiduciary Standard (zero-referral-fee rule)
4. Corporate Tax Friction Shields commentary (qualitative — e.g. Section 112 ITA inter-corporate dividend flow considerations; do not invent numeric figures)`;

      const DRAFT_TOOL_SCHEMA = {
        functionDeclarations: [
          {
            name: "draft_perspective_3_narratives",
            description: "Draft the four Operating Governance & Spoke Orchestration narratives.",
            parameters: {
              type: "OBJECT",
              properties: {
                hub_spoke_cadence_note: { type: "STRING" },
                tri_party_mou_note: { type: "STRING" },
                pure_fiduciary_standard_note: { type: "STRING" },
                tax_friction_shields_note: { type: "STRING" },
              },
              required: ["hub_spoke_cadence_note", "tri_party_mou_note", "pure_fiduciary_standard_note", "tax_friction_shields_note"],
            },
          },
        ],
      };

      let sa: ServiceAccountKey;
      try {
        sa = await parseServiceAccountKey(Deno.env.get("GCP_SERVICE_ACCOUNT_KEY"));
      } catch (e) {
        return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
      }

      let result;
      try {
        result = await generateVertexContent(
          sa,
          "gemini-2.5-flash",
          [{ role: "user", parts: [{ text: prompt }] }],
          { temperature: 0.4, maxOutputTokens: 4096 },
          {
            tools: [DRAFT_TOOL_SCHEMA],
            toolConfig: { functionCallingConfig: { mode: "ANY", allowedFunctionNames: ["draft_perspective_3_narratives"] } },
          },
        );
      } catch (e) {
        return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
      }

      const parts = result.candidates?.[0]?.content?.parts || [];
      // deno-lint-ignore no-explicit-any
      const fnCall = parts.find((p: any) => p.functionCall)?.functionCall;
      if (!fnCall?.args) return json({ ok: false, error: "The model did not return a usable draft." }, 500);

      return json({ ok: true, draft: fnCall.args });
    }

    if (action === "draft_perspective_4") {
      const { data: charter, error: charterErr } = await db
        .from("household_charters")
        .select("vision_text, core_values, grounding_principles, meeting_transcripts, legal_documents, treasury_snapshot")
        .eq("household_id", householdId)
        .maybeSingle();
      if (charterErr) return json({ ok: false, error: charterErr.message }, 500);
      if (!charter) return json({ ok: false, error: "No charter record for this household — call load first" }, 404);

      const values = (charter.core_values || []).map((v: NamedItem) => `${v.title}: ${v.description}`).join("\n");
      const principles = (charter.grounding_principles || [])
        .map((p: NamedItem) => `${p.title}: ${p.description}`)
        .join("\n");
      const transcripts = (charter.meeting_transcripts || [])
        .map((t: MeetingTranscript) => `--- ${t.title} ---\n${t.content_text}`)
        .join("\n\n");
      const legalDocs = (charter.legal_documents || [])
        .map((d: LegalDocument) => `--- [${d.source_category}] ${d.document_type} — ${d.title} ---\n${d.summary}`)
        .join("\n\n");
      const philanthropicBalance = charter.treasury_snapshot?.storehouse_reserves?.philanthropic;
      const philanthropicLine =
        typeof philanthropicBalance === "number"
          ? `Philanthropic Storehouse balance (real, computed): $${philanthropicBalance.toLocaleString("en-CA")} CAD`
          : "Philanthropic Storehouse balance: not yet computed — visit the Treasury & Capital Structure step.";

      const prompt = `You are drafting the "Human Capital & Generational Stewardship" perspective of a household's Sovereignty Charter for a wealth advisory firm.

Family Vision:
${charter.vision_text || "(not yet written)"}

Core Values:
${values || "(none)"}

System Grounding Principles:
${principles || "(none)"}

Meeting transcripts:
${transcripts || "(none synced yet)"}

Legal documents on file:
${legalDocs || "(none synced yet)"}

${philanthropicLine}

Draft the following two narratives, grounded strictly in the facts above — never invent a name, firm, amount, or fact not present in the supplied material (use the real philanthropic balance figure exactly as given, never re-derive or round it differently). If the supplied material doesn't support a confident draft for a given field, write a short honest placeholder noting what's missing rather than fabricating detail:
1. OpCo-to-WealthCo Identity Transition (the psychological/governance shift from operator to Chairman of the family balance sheet)
2. Philanthropic Stewardship Engine (the family's charitable directives and a self-sustaining endowment approach, referencing the real Philanthropic Storehouse balance above)`;

      const DRAFT_TOOL_SCHEMA = {
        functionDeclarations: [
          {
            name: "draft_perspective_4_narratives",
            description: "Draft the two Human Capital & Generational Stewardship narratives.",
            parameters: {
              type: "OBJECT",
              properties: {
                identity_transition_note: { type: "STRING" },
                philanthropic_stewardship_note: { type: "STRING" },
              },
              required: ["identity_transition_note", "philanthropic_stewardship_note"],
            },
          },
        ],
      };

      let sa: ServiceAccountKey;
      try {
        sa = await parseServiceAccountKey(Deno.env.get("GCP_SERVICE_ACCOUNT_KEY"));
      } catch (e) {
        return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
      }

      let result;
      try {
        result = await generateVertexContent(
          sa,
          "gemini-2.5-flash",
          [{ role: "user", parts: [{ text: prompt }] }],
          { temperature: 0.4, maxOutputTokens: 4096 },
          {
            tools: [DRAFT_TOOL_SCHEMA],
            toolConfig: { functionCallingConfig: { mode: "ANY", allowedFunctionNames: ["draft_perspective_4_narratives"] } },
          },
        );
      } catch (e) {
        return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
      }

      const parts = result.candidates?.[0]?.content?.parts || [];
      // deno-lint-ignore no-explicit-any
      const fnCall = parts.find((p: any) => p.functionCall)?.functionCall;
      if (!fnCall?.args) return json({ ok: false, error: "The model did not return a usable draft." }, 500);

      return json({ ok: true, draft: fnCall.args });
    }

    if (action === "mark_values_addendum_signed") {
      const { data, error } = await db
        .from("household_charters")
        .update({ family_values_addendum_signed_at: new Date().toISOString() })
        .eq("household_id", householdId)
        .select(CHARTER_FIELDS)
        .maybeSingle();
      if (error) return json({ ok: false, error: error.message }, 500);
      if (!data) return json({ ok: false, error: "No charter record for this household — call load first" }, 404);
      return json({ ok: true, charter: data });
    }

    if (action === "mark_values_addendum_reaffirmed") {
      const { data, error } = await db
        .from("household_charters")
        .update({ family_values_addendum_reaffirmed_at: new Date().toISOString() })
        .eq("household_id", householdId)
        .select(CHARTER_FIELDS)
        .maybeSingle();
      if (error) return json({ ok: false, error: error.message }, 500);
      if (!data) return json({ ok: false, error: "No charter record for this household — call load first" }, 404);
      return json({ ok: true, charter: data });
    }

    if (action === "complete") {
      const { data, error } = await db
        .from("household_charters")
        .update({ status: "complete", completed_at: new Date().toISOString(), completed_by: userId })
        .eq("household_id", householdId)
        .select(CHARTER_FIELDS)
        .maybeSingle();
      if (error) return json({ ok: false, error: error.message }, 500);
      if (!data) return json({ ok: false, error: "No charter record for this household — call load first" }, 404);
      return json({ ok: true, charter: data });
    }

    return json({ ok: false, error: `Unknown action: ${action}` }, 400);
  } catch (e) {
    console.error("charter-intake error:", e);
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
