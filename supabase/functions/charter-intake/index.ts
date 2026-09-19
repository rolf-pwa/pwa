// charter-intake — staff-only CRUD for the v2.0 Sovereignty Charter's
// "Foundational Bedrock" (Family Vision, Core Values, System Grounding
// Principles). Household-scoped, entirely separate from the v1
// contact-scoped sovereignty_charters table, which this function only
// ever reads from (for pre-fill), never writes to.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { computeStorehouseFundedPct, gatherHouseholdFinancials } from "../_shared/sovereignty-diagnostics.ts";
import { generateVertexContent, parseServiceAccountKey, type ServiceAccountKey } from "../_shared/vertex-ai.ts";
import { getServiceGoogleAccessToken } from "../_shared/google-token.ts";
import { driveDownloadFile, driveListChildren } from "../_shared/vault-provisioning.ts";

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

const MAX_TRANSCRIPT_CHARS = 20000;
const PDF_INLINE_MAX_BYTES = 18 * 1024 * 1024; // ~18 MB safe for inline base64

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
      return json({ ok: true, charter, prefill });
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
      ]);
      if (TEXT_COLUMNS.has(column)) {
        if (typeof value !== "string") return json({ ok: false, error: "Expected a text value" }, 400);
      } else if (column === "meeting_transcripts") {
        if (!isMeetingTranscriptArray(value)) {
          return json({ ok: false, error: "Expected an array of {id, title, content_text, added_at}" }, 400);
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
