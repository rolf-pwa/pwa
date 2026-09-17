import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://esm.sh/zod@3.25.76";
import { generateVertexContent, parseServiceAccountKey, extractJson } from "../_shared/vertex-ai.ts";

const ALLOWED_ORIGINS = [
  "https://prosperwise-portal.web.app",
  "https://prosperwise.lovable.app",
  "https://app.prosperwise.ca",
  "https://id-preview--339dfc8f-3e82-4b05-8a36-a9f66fc58449.lovable.app",
];

const MODEL = "gemini-2.5-flash";
const MAX_SOURCE_TEXT = 20000;
const MAX_SOURCES = 12;
const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID") || "";
const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET") || "";

async function getValidGoogleToken(admin: ReturnType<typeof createClient>, userId: string): Promise<string | null> {
  const { data, error } = await admin.from("google_tokens").select("*").eq("user_id", userId).maybeSingle();
  if (error || !data) return null;

  if (new Date(data.token_expiry as string) <= new Date()) {
    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) return null;
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        refresh_token: data.refresh_token as string,
        grant_type: "refresh_token",
      }),
    });
    const tokens = await res.json();
    if (tokens.error) return null;
    const newExpiry = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
    await admin.from("google_tokens").update({ access_token: tokens.access_token, token_expiry: newExpiry }).eq("user_id", userId);
    return tokens.access_token;
  }

  return data.access_token as string;
}

async function createCharterGoogleDoc(accessToken: string, title: string, markdown: string): Promise<{ id: string; url: string } | null> {
  // 1. Create the doc
  const createRes = await fetch("https://docs.googleapis.com/v1/documents", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
  const createData = await createRes.json();
  if (!createRes.ok || !createData.documentId) {
    console.error("Failed to create Google Doc:", createData);
    return null;
  }
  const documentId = createData.documentId as string;

  // 2. Insert markdown content as plain text body
  const body = (markdown || "").trim() || "Charter draft pending.";
  const updateRes = await fetch(`https://docs.googleapis.com/v1/documents/${documentId}:batchUpdate`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      requests: [
        { insertText: { location: { index: 1 }, text: body } },
      ],
    }),
  });
  if (!updateRes.ok) {
    const errText = await updateRes.text();
    console.error("Failed to write Google Doc body:", errText);
  }

  return { id: documentId, url: `https://docs.google.com/document/d/${documentId}/edit` };
}

const SourceSchema = z.object({
  sourceKind: z.enum(["statement", "stabilization_session", "meeting_transcript", "link", "note"]),
  title: z.string().trim().min(1).max(120),
  inputMode: z.enum(["upload", "text", "url"]),
  contentText: z.string().trim().max(MAX_SOURCE_TEXT).optional(),
  sourceUrl: z.string().trim().url().max(2000).optional(),
  storagePath: z.string().trim().max(500).optional(),
  fileName: z.string().trim().max(255).optional(),
  mimeType: z.string().trim().max(255).optional(),
  importOrigin: z.string().trim().max(50).optional(),
  externalFileId: z.string().trim().max(255).optional(),
  externalModifiedAt: z.string().datetime({ offset: true }).optional(),
  externalFolderId: z.string().trim().max(255).optional(),
  syncError: z.string().trim().max(2000).optional(),
}).superRefine((value, ctx) => {
  if (value.inputMode === "text" && !value.contentText) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Text content is required" });
  }
  if (value.inputMode === "url" && !value.sourceUrl) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Source URL is required" });
  }
  if (value.inputMode === "upload" && !value.storagePath) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Uploaded file path is required" });
  }
});

const BodySchema = z.object({
  contactId: z.string().uuid(),
  charterId: z.string().uuid().optional(),
  sources: z.array(SourceSchema).min(1).max(MAX_SOURCES),
});

type SourceInput = z.infer<typeof SourceSchema>;

type ApiResponse = {
  ok: boolean;
  error?: string;
  diagnostics?: Record<string, unknown>;
  charterId?: string;
  charter?: unknown;
  sources?: unknown[];
  summary?: string;
};

const SOVEREIGN_ARCHITECT_SYSTEM_PROMPT = `ROLE

You are the "Sovereign Architect." Your role is to draft the $3,999 Sovereignty Charter—a formal family constitution. You utilize the BMgt and CLU perspective to create a document of partner-level quality intended to drive referrals from Legal and Tax professionals.

CORE PHILOSOPHY

The Perimeter: The Charter is the boundary between family peace and "The Noise."

Professional Alliance: We do not compete with the Lawyer/CPA; we provide the strategic architecture that their documents must inhabit.

Command Phase: This document marks the end of "The Quiet Period."

DRAFTING STRUCTURE

1. Preamble, Mission, & Vision

Define the transition and the end of the Quiet Period.

Synthesize the "Purpose of Capital" into a 1-2 sentence Mission.

Describe a 20-year Vision of family flourishing.

2. Articles of Governance

Article I: Governance & Authority: Define the decision-rights between Steward and Architect.

Article II: Conflict Resolution: Codify "Sovereign Mediation" to protect the Steward from family pressure.

Article III: Fiduciary Alliance: Specific directives for Legal and Tax partners. Use technical language to demonstrate "Partner-level" work quality.

Article IV: Succession: Detailed instructions for Executors and Trustees.

Article VI: Future Inflows: Codify the Secondary Quiet Period (90 days) for all future inheritances over $50k.

3. Appendix A: The Structural Architecture

The Storehouse ($100k): The immediate Assuris-protected safety buffer.

The Vineyard ($900k): The growth-oriented economic engine.

Legacy Trust: Real estate and foundational hard assets.

The Tributary: Acknowledge the $20k/year in government benefits (CPP/OAS/Survivor).

4. The Harvest Protocol

Define the annual Harvest Date (e.g., October 1st).

Establish the Sovereignty Threshold logic ($120k total: $100k from Vineyard + $20k from Tributary).

Detail the replenishment of the Philanthropic Trust (Cash) and Strategic Reserve (Children's Future).

5. Ratification

Include signature blocks for the Sovereign, Personal CFO, Legal Counsel, and Tax Professional.

TONE & VOICE

"The Steady Hand": Weighty, authoritative, and serif-styled in spirit.

Terminology: Use ProsperWise terms exclusively (Vineyard, Storehouse, Harvest, Sovereignty, Command).

OUTPUT FORMAT

Clean, high-authority Markdown. Ensure the layout reflects the "Visual Sovereignty" of a Constitution.`;

function getCorsHeaders(req: Request) {
  const origin = req.headers.get("Origin") || "";
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  };
}

function respond(req: Request, payload: ApiResponse) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
  });
}

function formatCurrency(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return "Unknown";
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 }).format(value);
}

function buildDefaultCharter(contact: any, family: any | null, totalStewardship: number) {
  const resolvedFullName = [contact.first_name, contact.last_name].filter(Boolean).join(" ");
  const quietDate = contact.quiet_period_start_date
    ? new Date(contact.quiet_period_start_date).toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric" })
    : null;

  return {
    contact_id: contact.id,
    title: `${family?.name || resolvedFullName} Sovereignty Charter`,
    subtitle: "A constitutional framework for financial governance",
    intro_heading: "Constitutional Framework\nfor Financial Governance",
    intro_callout: `The assets of ${resolvedFullName} are to be governed as a Vineyard designed to serve stability, legacy, and disciplined decision-making rather than short-term reaction.`,
    intro_note: "This portrait format mirrors the Stabilization Map and Quarterly Review so the Charter reads like one unified governance system.",
    mission_of_capital: `The current territory is stewarded toward durable household stability, tax-aware growth, and long-horizon legacy transfer. ${family?.annual_savings ? `The family is currently tracking approximately ${formatCurrency(family.annual_savings)} in annual savings capacity.` : "The strategy should define a target after-tax cash flow threshold and a reinvestment discipline."}`,
    vision_20_year: `${family?.total_family_assets ? `Current tracked family assets are ${formatCurrency(family.total_family_assets)}.` : `Current tracked stewardship value is ${formatCurrency(totalStewardship)}.`} The long-range objective is to compound core Vineyard assets, protect key reserves, and preserve intergenerational optionality through a deliberate governance structure.`,
    governance_authority: `${resolvedFullName} remains the sovereign decision-maker. ProsperWise serves as Personal CFO, coordinating structure, sequencing, and the architectural integrity of the Charter.`,
    conflict_resolution: `${contact.poa_name ? `Powers of Attorney currently noted: ${contact.poa_name}.` : "Powers of Attorney should be named explicitly."} In incapacity events, this Charter operates as an interpretive guide for aligned decision-making.`,
    fiduciary_alliance: `${contact.lawyer_name || contact.accountant_name ? `Current professionals include ${[contact.lawyer_name, contact.accountant_name].filter(Boolean).join(" and ")}.` : "Legal and tax professionals should be linked to this Charter."} All structural and tax actions remain subject to professional review.`,
    quiet_period: quietDate
      ? `A quiet period anchor exists from ${quietDate}. New capital events should pause for structured integration before deployment.`
      : "Capital inflows above the family threshold should trigger a quiet period before new deployment decisions are finalized.",
    architecture_intro: "The Vineyard serves as the master container for income-generating assets. Principal is protected by design; only designated harvest should move into storehouse allocation.",
    protected_assets_note: "No protected accounts have been explicitly classified yet.",
    harvest_accounts_note: "No eligible harvest accounts are currently defined.",
    appendix_note: "This appendix condenses the current territory into a printable schedule so the Charter, Stabilization Map, and Quarterly Review all reference the same canonical structure.",
    footer_status: contact.households?.governance_status === "sovereign" ? "Ratified / Sovereign phase" : "Draft / review in progress",
    footer_date_label: quietDate || "Ratification date to be confirmed",
    custom_sections: { pageOne: [], pageTwo: [] },
    draft_status: "draft",
  };
}

async function fetchUploadedText(admin: ReturnType<typeof createClient>, source: SourceInput) {
  if (!source.storagePath) return "";

  const { data, error } = await admin.storage.from("charter-source-uploads").download(source.storagePath);
  if (error || !data) {
    throw new Error(`Failed to read uploaded file: ${source.fileName || source.title}`);
  }

  const mimeType = source.mimeType || data.type || "application/octet-stream";
  if (mimeType.includes("pdf")) {
    return `[Uploaded PDF: ${source.fileName || source.title}. Use this as a supporting source document. Detailed PDF parsing is not yet enabled in this step.]`;
  }

  return (await data.text()).slice(0, MAX_SOURCE_TEXT);
}

function compactSourceText(source: SourceInput, extractedText: string) {
  const parts = [
    `Type: ${source.sourceKind}`,
    `Title: ${source.title}`,
  ];

  if (source.sourceUrl) parts.push(`URL: ${source.sourceUrl}`);
  if (source.fileName) parts.push(`File: ${source.fileName}`);

  const body = extractedText.trim().slice(0, MAX_SOURCE_TEXT);
  if (body) parts.push(`Content:\n${body}`);

  return parts.join("\n");
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const parsed = BodySchema.safeParse(await req.json());
    if (!parsed.success) {
      const flattened = parsed.error.flatten();
      const firstFieldError = Object.values(flattened.fieldErrors).flat()[0];
      return respond(req, {
        ok: false,
        error: flattened.formErrors[0] || firstFieldError || "Invalid request",
        diagnostics: { stage: "validation", fieldErrors: flattened.fieldErrors },
      });
    }

    const authHeader = req.headers.get("Authorization") || "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    if (!jwt) {
      return respond(req, { ok: false, error: "Unauthorized", diagnostics: { stage: "auth_missing_jwt" } });
    }

    const authClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });
    const { data: authData, error: authError } = await authClient.auth.getUser();
    const user = authData?.user;
    if (authError || !user || !user.email?.toLowerCase().endsWith("@prosperwise.ca")) {
      return respond(req, { ok: false, error: "Unauthorized", diagnostics: { stage: "auth_user_validation" } });
    }

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { contactId, charterId, sources } = parsed.data;

    const [{ data: contact, error: contactError }, { data: existingCharter, error: charterError }] = await Promise.all([
      admin
        .from("contacts")
        .select("id, first_name, last_name, full_name, family_id, household_id, charter_url, quiet_period_start_date, households(governance_status), lawyer_name, accountant_name, executor_name, poa_name, email, phone")
        .eq("id", contactId)
        .single(),
      charterId
        ? admin.from("sovereignty_charters").select("*").eq("id", charterId).maybeSingle()
        : admin.from("sovereignty_charters").select("*").eq("contact_id", contactId).maybeSingle(),
    ]);

    if (contactError || !contact) {
      return respond(req, { ok: false, error: "Contact not found", diagnostics: { stage: "contact_lookup" } });
    }
    if (charterError) throw charterError;

    const familyId = contact.family_id;
    const [familyRes, vineyardRes, storehouseRes, rulesRes, kbRes] = await Promise.all([
      familyId
        ? admin.from("families").select("id, name, charter_document_url, total_family_assets, annual_savings, fee_tier").eq("id", familyId).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      admin.from("vineyard_accounts").select("id, account_name, account_number, account_type, current_value, book_value, notes").eq("contact_id", contactId).order("created_at"),
      admin.from("storehouses").select("id, label, storehouse_number, current_value, target_value, asset_type, notes, risk_cap").eq("contact_id", contactId).order("storehouse_number"),
      familyId
        ? admin.from("storehouse_rules").select("id, storehouse_label, storehouse_number, rule_type, rule_description, rule_value").eq("family_id", familyId).order("storehouse_number")
        : Promise.resolve({ data: [], error: null }),
      admin.from("knowledge_base").select("title, category, content").eq("is_active", true).in("target", ["charter-draft", "both"]).order("category"),
    ]);

    if (familyRes.error) throw familyRes.error;
    if (vineyardRes.error) throw vineyardRes.error;
    if (storehouseRes.error) throw storehouseRes.error;
    if (rulesRes.error) throw rulesRes.error;
    if (kbRes.error) throw kbRes.error;

    const knowledgeBaseEntries = (kbRes.data || []) as Array<{ title: string; category: string; content: string }>;
    const knowledgeBaseBlock = knowledgeBaseEntries.length
      ? `\n\nADDITIONAL KNOWLEDGE BASE (editable in /knowledge-base, target = "charter-draft"):\n\n${knowledgeBaseEntries
          .map((entry) => `### ${entry.title} [${entry.category}]\n${entry.content}`)
          .join("\n\n")}`
      : "";

    const vineyardAccounts = vineyardRes.data || [];
    const storehouses = storehouseRes.data || [];
    const totalStewardship = [...vineyardAccounts, ...storehouses].reduce((sum, row: any) => sum + (Number(row.current_value) || 0), 0);
    const baseCharter = buildDefaultCharter(contact, familyRes.data || null, totalStewardship);

    const preparedSources = await Promise.all(
      sources.map(async (source, index) => {
        let extractedText = source.contentText?.trim() || "";
        if (source.inputMode === "upload") {
          extractedText = await fetchUploadedText(admin, source);
        }
        if (source.inputMode === "url" && source.sourceUrl) {
          extractedText = `Linked resource for reference: ${source.sourceUrl}`;
        }

        return {
          db: {
            charter_id: existingCharter?.id || null,
            contact_id: contactId,
            source_kind: source.sourceKind,
            input_mode: source.inputMode,
            title: source.title,
            source_url: source.sourceUrl || null,
            content_text: source.contentText?.trim() || null,
            extracted_text: extractedText || null,
            storage_bucket: source.storagePath ? "charter-source-uploads" : null,
            storage_path: source.storagePath || null,
            file_name: source.fileName || null,
            mime_type: source.mimeType || null,
            import_origin: source.importOrigin || "manual",
            external_file_id: source.externalFileId || null,
            external_modified_at: source.externalModifiedAt || null,
            external_folder_id: source.externalFolderId || null,
            sync_error: source.syncError || null,
            sort_order: index,
            created_by: user.id,
          },
          promptText: compactSourceText(source, extractedText),
        };
      })
    );

    const systemPrompt = `${SOVEREIGN_ARCHITECT_SYSTEM_PROMPT}${knowledgeBaseBlock}

You are ProsperWise's charter architect. Draft the initial Sovereignty Charter using only the supplied contact profile, current financial structure, and resource materials.

Return a JSON object with these fields:

LEGACY DISPLAY FIELDS (strings):
- title, subtitle, intro_heading, intro_callout, intro_note, mission_of_capital, vision_20_year, governance_authority, conflict_resolution, fiduciary_alliance, quiet_period, architecture_intro, protected_assets_note, harvest_accounts_note, appendix_note, footer_status, footer_date_label, generation_summary, full_markdown

PURPOSE & OBJECTIVES (strings; from the Charter draft's "Purpose & Objectives" section):
- transition_summary: 1-3 sentences describing the financial transition the family is navigating (sale, inheritance, retirement, etc.)
- primary_goal: a single concise sentence stating the primary financial goal (e.g., "Preserve capital and generate sustainable income while protecting the family from outside financial pressure")
- long_term_strategy: 2-4 sentences on the long-term capital deployment strategy (growth assets, reserves, philanthropic intent)

GOVERNANCE & SAFEGUARDS (strings):
- roles_responsibilities: who decides what (Sovereign / Personal CFO / advisors)
- withdrawal_safeguards: rules and limits around withdrawals from growth assets
- secondary_quiet_period_rule: rule for future inflows above the family's threshold (e.g., "All future inflows over $50k trigger a 90-day Quiet Period")
- professional_coordination: how lawyer/CPA/insurance professionals coordinate with the Charter
- monitoring_cadence: how often the Charter is reviewed (quarterly, annually, etc.)

GROWTH ASSETS (numbers may be null if unknown; strings otherwise):
- growth_primary_label: short label for the primary growth asset (e.g., "Investment Portfolio", "Operating Business")
- growth_primary_value: numeric current value (number, not string), or null if unknown
- growth_primary_detail: 1-2 sentences describing the primary growth asset's role
- growth_secondary_label, growth_secondary_value, growth_secondary_detail: same structure for the secondary growth asset (or null/empty if none)

STOREHOUSES (numbers may be null; strings otherwise):
- storehouse_liquidity_value: numeric current value of liquidity reserves, or null
- storehouse_liquidity_detail: 1-2 sentences describing the liquidity reserve target/policy
- storehouse_strategic_value: numeric current value of strategic reserves, or null
- storehouse_strategic_detail: 1-2 sentences describing strategic reserve purpose
- storehouse_philanthropic_detail: 1-2 sentences on philanthropic chamber (purpose, vehicle)
- storehouse_legacy_detail: 1-2 sentences on legacy/intergenerational chamber

ANNUAL HARVEST (numbers may be null; strings otherwise):
- harvest_target_income: numeric annual target income from the Vineyard, or null
- harvest_yield_protocol: 2-4 sentences describing the harvest date, yield protocol, and replenishment rules
- harvest_spending_categories: short summary of spending categories the harvest funds
- harvest_review_date: ISO date string (YYYY-MM-DD) for the next harvest review, or null

SUCCESSION (strings):
- executor_primary: name of the primary executor, or empty string if unknown
- executor_alternate: name of the alternate executor, or empty string if unknown
- succession_terms: 2-4 sentences summarizing succession terms and instructions to executors

RATIFICATION:
- ratification_signatories: a JSON array of objects with shape { "role": string, "name": string, "signed_at": string|null }. Include the Sovereign, Personal CFO, Legal Counsel, and Tax Professional. Use empty string for "name" if unknown and null for "signed_at" if not yet signed.

CUSTOM SECTIONS:
- custom_sections: an object with pageOne and pageTwo arrays, where each array contains objects with title, meta, and body. Keep pageOne containers constitutional/governance oriented and pageTwo containers operational/container oriented.

Use the template fields to summarize and structure the charter for the designed ProsperWise layout, but also produce full_markdown as the complete long-form constitutional document ready to append to the final document.

CRITICAL RULES:
- Do not invent facts, numbers, institutions, or family members not supported by the materials.
- For numeric fields, return JSON numbers (not strings, not currency-formatted text). Use null when unknown.
- For string fields where data is unknown, use careful language noting the detail remains to be confirmed (do not fabricate).
- Pull values directly from the supplied Sovereignty Charter draft document when present; only synthesize from financial structure when the draft is silent.`;

    const userPrompt = JSON.stringify({
      contact,
      family: familyRes.data || null,
      vineyardAccounts,
      storehouses,
      storehouseRules: rulesRes.data || [],
      existingDraft: existingCharter ? {
        title: existingCharter.title,
        subtitle: existingCharter.subtitle,
        intro_heading: existingCharter.intro_heading,
        intro_callout: existingCharter.intro_callout,
        intro_note: existingCharter.intro_note,
        mission_of_capital: existingCharter.mission_of_capital,
        vision_20_year: existingCharter.vision_20_year,
        governance_authority: existingCharter.governance_authority,
        conflict_resolution: existingCharter.conflict_resolution,
        fiduciary_alliance: existingCharter.fiduciary_alliance,
        quiet_period: existingCharter.quiet_period,
        architecture_intro: existingCharter.architecture_intro,
        protected_assets_note: existingCharter.protected_assets_note,
        harvest_accounts_note: existingCharter.harvest_accounts_note,
        appendix_note: existingCharter.appendix_note,
        footer_status: existingCharter.footer_status,
        footer_date_label: existingCharter.footer_date_label,
        custom_sections: existingCharter.custom_sections,
      } : baseCharter,
      sourceMaterials: preparedSources.map((item) => item.promptText),
    });

    let parsedDraft: any;
    try {
      const sa = await parseServiceAccountKey(Deno.env.get("GCP_SERVICE_ACCOUNT_KEY"));
      const vertexResult = await generateVertexContent(
        sa,
        MODEL,
        [{ role: "user", parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }] }],
        { temperature: 0.4, maxOutputTokens: 8192, responseMimeType: "application/json" },
      );
      const rawText = vertexResult?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join("") || "";
      parsedDraft = extractJson(rawText);
    } catch (aiErr) {
      const message = aiErr instanceof Error ? aiErr.message : String(aiErr);
      return respond(req, { ok: false, error: "AI generation failed", diagnostics: { stage: "vertex_ai", message } });
    }

    const customSections = {
      pageOne: Array.isArray(parsedDraft.custom_sections?.pageOne) ? parsedDraft.custom_sections.pageOne : [],
      pageTwo: Array.isArray(parsedDraft.custom_sections?.pageTwo) ? parsedDraft.custom_sections.pageTwo : [],
    };

    const toNullableNumber = (value: unknown): number | null => {
      if (value === null || value === undefined || value === "") return null;
      const num = typeof value === "number" ? value : Number(String(value).replace(/[^0-9.\-]/g, ""));
      return Number.isFinite(num) ? num : null;
    };
    const toNullableString = (value: unknown): string | null => {
      if (value === null || value === undefined) return null;
      const str = String(value).trim();
      return str ? str : null;
    };
    const toNullableDate = (value: unknown): string | null => {
      const str = toNullableString(value);
      if (!str) return null;
      // Accept YYYY-MM-DD or ISO; normalize to YYYY-MM-DD
      const match = str.match(/^(\d{4}-\d{2}-\d{2})/);
      return match ? match[1] : null;
    };
    const toSignatoriesArray = (value: unknown) => {
      if (!Array.isArray(value)) return [] as Array<{ role: string; name: string; signed_at: string | null }>;
      return value
        .filter((row): row is Record<string, unknown> => !!row && typeof row === "object")
        .map((row) => ({
          role: String(row.role || "").trim(),
          name: String(row.name || "").trim(),
          signed_at: toNullableDate(row.signed_at),
        }))
        .filter((row) => row.role || row.name);
    };

    const draftPayload = {
      contact_id: contactId,
      title: String(parsedDraft.title || baseCharter.title),
      subtitle: String(parsedDraft.subtitle || baseCharter.subtitle),
      intro_heading: String(parsedDraft.intro_heading || baseCharter.intro_heading),
      intro_callout: String(parsedDraft.intro_callout || baseCharter.intro_callout),
      intro_note: String(parsedDraft.intro_note || baseCharter.intro_note),
      mission_of_capital: String(parsedDraft.mission_of_capital || baseCharter.mission_of_capital),
      vision_20_year: String(parsedDraft.vision_20_year || baseCharter.vision_20_year),
      governance_authority: String(parsedDraft.governance_authority || baseCharter.governance_authority),
      conflict_resolution: String(parsedDraft.conflict_resolution || baseCharter.conflict_resolution),
      fiduciary_alliance: String(parsedDraft.fiduciary_alliance || baseCharter.fiduciary_alliance),
      quiet_period: String(parsedDraft.quiet_period || baseCharter.quiet_period),
      architecture_intro: String(parsedDraft.architecture_intro || baseCharter.architecture_intro),
      protected_assets_note: String(parsedDraft.protected_assets_note || baseCharter.protected_assets_note),
      harvest_accounts_note: String(parsedDraft.harvest_accounts_note || baseCharter.harvest_accounts_note),
      appendix_note: String(parsedDraft.appendix_note || baseCharter.appendix_note),
      footer_status: String(parsedDraft.footer_status || "Draft / AI-generated"),
      footer_date_label: String(parsedDraft.footer_date_label || baseCharter.footer_date_label),
      // ── New structured fields (Hybrid template) ──
      transition_summary: toNullableString(parsedDraft.transition_summary),
      primary_goal: toNullableString(parsedDraft.primary_goal),
      long_term_strategy: toNullableString(parsedDraft.long_term_strategy),
      roles_responsibilities: toNullableString(parsedDraft.roles_responsibilities),
      withdrawal_safeguards: toNullableString(parsedDraft.withdrawal_safeguards),
      secondary_quiet_period_rule: toNullableString(parsedDraft.secondary_quiet_period_rule),
      professional_coordination: toNullableString(parsedDraft.professional_coordination),
      monitoring_cadence: toNullableString(parsedDraft.monitoring_cadence),
      growth_primary_label: toNullableString(parsedDraft.growth_primary_label),
      growth_primary_value: toNullableNumber(parsedDraft.growth_primary_value),
      growth_primary_detail: toNullableString(parsedDraft.growth_primary_detail),
      growth_secondary_label: toNullableString(parsedDraft.growth_secondary_label),
      growth_secondary_value: toNullableNumber(parsedDraft.growth_secondary_value),
      growth_secondary_detail: toNullableString(parsedDraft.growth_secondary_detail),
      storehouse_liquidity_value: toNullableNumber(parsedDraft.storehouse_liquidity_value),
      storehouse_liquidity_detail: toNullableString(parsedDraft.storehouse_liquidity_detail),
      storehouse_strategic_value: toNullableNumber(parsedDraft.storehouse_strategic_value),
      storehouse_strategic_detail: toNullableString(parsedDraft.storehouse_strategic_detail),
      storehouse_philanthropic_detail: toNullableString(parsedDraft.storehouse_philanthropic_detail),
      storehouse_legacy_detail: toNullableString(parsedDraft.storehouse_legacy_detail),
      harvest_target_income: toNullableNumber(parsedDraft.harvest_target_income),
      harvest_yield_protocol: toNullableString(parsedDraft.harvest_yield_protocol),
      harvest_spending_categories: toNullableString(parsedDraft.harvest_spending_categories),
      harvest_review_date: toNullableDate(parsedDraft.harvest_review_date),
      executor_primary: toNullableString(parsedDraft.executor_primary),
      executor_alternate: toNullableString(parsedDraft.executor_alternate),
      succession_terms: toNullableString(parsedDraft.succession_terms),
      ratification_signatories: toSignatoriesArray(parsedDraft.ratification_signatories),
      // ── End new fields ──
      custom_sections: customSections,
      draft_status: "generated",
      generation_summary: String(parsedDraft.generation_summary || "Initial AI draft generated from the provided charter resources."),
      full_markdown: String(parsedDraft.full_markdown || ""),
      last_generated_at: new Date().toISOString(),
    };

    let savedCharterId = existingCharter?.id as string | undefined;
    if (savedCharterId) {
      const { error } = await admin.from("sovereignty_charters").update(draftPayload).eq("id", savedCharterId);
      if (error) throw error;
    } else {
      const { data, error } = await admin.from("sovereignty_charters").insert(draftPayload).select("id").single();
      if (error || !data) throw error || new Error("Failed to save charter");
      savedCharterId = data.id;
    }

    await admin.from("sovereignty_charter_sources").delete().eq("contact_id", contactId);

    const sourceInsertRows = preparedSources.map((item) => ({ ...item.db, charter_id: savedCharterId || null }));
    if (sourceInsertRows.length > 0) {
      const { error } = await admin.from("sovereignty_charter_sources").insert(sourceInsertRows);
      if (error) throw error;
    }

    const { data: savedCharter, error: savedCharterError } = await admin
      .from("sovereignty_charters")
      .select("*")
      .eq("id", savedCharterId)
      .single();
    if (savedCharterError || !savedCharter) throw savedCharterError || new Error("Failed to reload charter");

    // Create / replace working Google Doc draft (best-effort; non-fatal on failure)
    let googleDocUrl: string | null = null;
    let googleDocError: string | null = null;
    try {
      const accessToken = await getValidGoogleToken(admin, user.id);
      if (!accessToken) {
        googleDocError = "Google not connected for this user; skipped Google Doc creation.";
      } else {
        const docTitle = `${draftPayload.title} — Working Draft`;
        const doc = await createCharterGoogleDoc(accessToken, docTitle, draftPayload.full_markdown);
        if (doc) {
          googleDocUrl = doc.url;
          await admin.from("contacts").update({ charter_url: doc.url }).eq("id", contactId);
        } else {
          googleDocError = "Google Doc creation failed; see edge function logs.";
        }
      }
    } catch (docErr) {
      console.error("Google Doc creation error:", docErr);
      googleDocError = docErr instanceof Error ? docErr.message : "Unknown Google Doc error";
    }

    return respond(req, {
      ok: true,
      charterId: savedCharterId,
      charter: savedCharter,
      sources: sourceInsertRows,
      summary: draftPayload.generation_summary,
      diagnostics: { googleDocUrl, googleDocError },
    });
  } catch (error) {
    console.error("generate-charter-draft error:", error);
    return respond(req, {
      ok: false,
      error: error instanceof Error ? error.message : "Unknown error",
      diagnostics: { stage: "unhandled" },
    });
  }
});