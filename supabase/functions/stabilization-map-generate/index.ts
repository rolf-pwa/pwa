import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  computeSovereigntyDiagnostics,
  type DiagnosticInputs,
} from "../_shared/sovereignty-diagnostics.ts";
import { georgiaFactLines, type GeorgiaLeadFacts } from "../_shared/georgia-diagnostic-facts.ts";
import { evaluateCausalDag, type OntologyAssessmentPayload, type RiskFlag } from "../_shared/causal-dag-evaluator.ts";

const ALLOWED_ORIGINS = [
  "https://prosperwise-portal.web.app",
  "https://prosperwise.lovable.app",
  "https://app.prosperwise.ca",
  "https://id-preview--339dfc8f-3e82-4b05-8a36-a9f66fc58449.lovable.app",
];

function getCorsHeaders(req: Request) {
  const origin = req.headers.get("Origin") || "";
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  };
}

// ---------- Vertex AI ----------
const REGION = "northamerica-northeast1";
const MODEL = "gemini-2.5-flash";

interface ServiceAccountKey {
  type: string;
  project_id: string;
  private_key: string;
  client_email: string;
  token_uri: string;
}

async function getAccessToken(sa: ServiceAccountKey): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/cloud-platform",
    aud: sa.token_uri,
    iat: now,
    exp: now + 3600,
  };
  const enc = (obj: unknown) =>
    btoa(JSON.stringify(obj)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const unsigned = `${enc(header)}.${enc(payload)}`;
  const pemBody = sa.private_key
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s/g, "");
  const binaryKey = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    binaryKey,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signatureBuffer = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    new TextEncoder().encode(unsigned),
  );
  const signature = btoa(String.fromCharCode(...new Uint8Array(signatureBuffer)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  const jwt = `${unsigned}.${signature}`;
  const res = await fetch(sa.token_uri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error(`Token exchange failed: ${data.error_description || data.error}`);
  return data.access_token;
}

// ---------- Extraction Prompt ----------

const EXTRACTION_PROMPT = `You are an expert ProsperWise stabilization analyst. You are drafting a one-page **Stabilization Map** that Rolf Issler will review with the client in their first live Stabilization Session.

You will receive:
1. The raw intake data captured by Georgia (the AI Transition Assistant) — transition type, anxiety anchor, vision, vineyard summary, and full discovery notes.
2. The client's first name.

Your job: fill every field of the Stabilization Map with concrete, client-specific content derived STRICTLY from the intake.

## Rules
- **Never fabricate** numbers, dates, firm names, or facts not present in the intake. If unknown, say so ("amount unspecified", "tax advisor not yet engaged", etc.).
- **Write in the Sanctuary voice** — calm, direct, non-alarmist, professional. No jargon. No exclamations.
- **Each risk and next step MUST be a single line, max ~60 characters**, following the template style ("Short noun phrase — concrete consequence or action").
- **Always fill all 5 risks and all 5 next steps**. If the intake is sparse, extrapolate the most likely SWS-stage risks for the event type.
- **Status fields** MUST use the exact enum values:
  - storehouse_status: "Not Established" | "Partial" | "Established"
  - solicitation_status: "Not Established" | "Partial" | "Established"
  - sovereignty_charter_status: "Not Started" | "In Progress" | "Complete"
  - tax_status: "Not Assessed" | "In Progress" | "Assessed"
- **event_type** must be one of: "Business Exit" | "Inheritance" | "Sudden Windfall" | "Taxable Event".
- **situation_summary**: 1–2 sentences summarising the triggering event in the style: "You completed/received [event] on [date if known]. [Current state of the capital or situation]."
- **urgency_flag**: 1 sentence describing what is currently absent or exposed — governance gaps, active solicitation pressure, missing Quiet Period, etc.
- **Detail fields** (storehouse_detail, solicitation_detail, sovereignty_charter_detail, tax_detail): one short sentence each, describing the current state and why.
- **logic_trace**: 2–4 sentences explaining, for Rolf's eyes only, why you chose the risks, next steps, and status levels from the intake.

## Output
Call the \`populate_stabilization_map\` function with all fields filled.`;

const TOOL_SCHEMA = {
  functionDeclarations: [
    {
      name: "populate_stabilization_map",
      description: "Populate every field of the Stabilization Map from the Georgia intake.",
      parameters: {
        type: "OBJECT",
        properties: {
          event_type: {
            type: "STRING",
            description: "One of: Business Exit, Inheritance, Sudden Windfall, Taxable Event",
          },
          situation_summary: { type: "STRING" },
          urgency_flag: { type: "STRING" },
          risk_1: { type: "STRING" },
          risk_2: { type: "STRING" },
          risk_3: { type: "STRING" },
          risk_4: { type: "STRING" },
          risk_5: { type: "STRING" },
          next_step_1: { type: "STRING" },
          next_step_2: { type: "STRING" },
          next_step_3: { type: "STRING" },
          next_step_4: { type: "STRING" },
          next_step_5: { type: "STRING" },
          storehouse_status: { type: "STRING" },
          storehouse_detail: { type: "STRING" },
          solicitation_status: { type: "STRING" },
          solicitation_detail: { type: "STRING" },
          sovereignty_charter_status: { type: "STRING" },
          sovereignty_charter_detail: { type: "STRING" },
          tax_status: { type: "STRING" },
          tax_detail: { type: "STRING" },
          logic_trace: { type: "STRING" },
        },
        required: [
          "event_type",
          "situation_summary",
          "urgency_flag",
          "risk_1",
          "risk_2",
          "risk_3",
          "risk_4",
          "risk_5",
          "next_step_1",
          "next_step_2",
          "next_step_3",
          "next_step_4",
          "next_step_5",
          "storehouse_status",
          "storehouse_detail",
          "solicitation_status",
          "solicitation_detail",
          "sovereignty_charter_status",
          "sovereignty_charter_detail",
          "tax_status",
          "tax_detail",
          "logic_trace",
        ],
      },
    },
  ],
};

// ---------- Household-track (Sovereignty Survey) narrative prompt ----------
// Numbers are never generated here — they're computed deterministically by
// sovereignty-diagnostics.ts and handed in as read-only facts. The model only
// drafts prose: the situation summary, urgency flag, and 90-day action plan
// bullets, exactly like generate-charter-draft does for the Sovereignty Charter.

const HOUSEHOLD_EXTRACTION_PROMPT = `You are an expert ProsperWise stabilization analyst. You are drafting the narrative portions of a one-page **Sovereignty Survey Stabilization Map** that Rolf Issler will review with the client in their first live Stabilization Session.

You will receive already-computed, verified facts about the household: its wealth event, track type (personal or corporate), document readiness, and — where applicable — quantified financial diagnostics (fee drag, tax exposure, governance risk flags). These numbers are final and correct.

Your job: draft ONLY the narrative fields below. **Never invent, restate incorrectly, or alter any dollar figure or percentage** — reference them by describing their significance, not by recomputing them.

## Rules
- Write in the Sanctuary voice — calm, direct, non-alarmist, professional. No jargon, no exclamations.
- If the facts state this is an existing/managed client formalizing their SOS (not a new engagement), the situation_summary and Phase 1 action items must reflect *formalizing/ratifying* their existing arrangement — never use "initiating," "Day One," or basic-document-collection language ("secure government IDs," "collect bank statements") for a client who already has a governed relationship on file.
- If a "Causal AI Ontology assessment" or "Active Causal Risk Flags" fact is present, you may draw on it when writing the urgency_flag and Phase 1 action items — but NEVER quote a raw score, index, or internal field name from it (never write anything like "guilt/survivor feelings 9/10" or "secrecy_isolation_score"). Translate it into plain advisor language describing the real-world behavior or risk instead (e.g. "there are early signs of guilt-driven hesitation around engaging with this inheritance"). Named risk flags (e.g. "Legacy Asset Liquidation Paralysis") and their recommended actions ARE safe to reference directly — those are already advisor-facing labels, not raw internal data.
- If a "Georgia diagnostic" fact is present, it is what the client told us about themselves before engaging: you may let it shape the tone of the situation_summary and the emphasis of the Phase 1 action items (for example, acknowledging that outside pressure or feeling stuck is real, or that governance is not yet written down). Translate it into plain advisor language. NEVER quote a score, never write "the diagnostic said" or "the client stated", and never present these as direct quotes or as verified facts — they are self-reported context, not findings.
- situation_summary: 1-2 sentences summarizing the household's transition/wealth event and current state of stabilization.
- urgency_flag: 1 sentence describing what is currently absent or exposed (governance gaps, unaddressed drag, missing structure).
- Action plan: draft 2-4 concrete bullet items for EACH of three phases, grounded in the facts provided:
  - Phase 1 (Immediate, Days 1-30): protective/administrative steps — never structural changes.
  - Phase 2 (Structural Purification, Days 31-60): the concrete structural/tax remediation this household's facts call for.
  - Phase 3 (Governance Ratification, Days 61-90): charter/governance ratification and cadence-setting steps.
  - Each bullet needs a short title (max ~50 characters) and one supporting sentence of detail. Keep every field concise — the response must complete well within the output budget, so do not pad with extra detail beyond what's requested.

## Output
Call \`populate_household_stabilization_map\` with all fields filled.`;

const HOUSEHOLD_TOOL_SCHEMA = {
  functionDeclarations: [
    {
      name: "populate_household_stabilization_map",
      description: "Populate the narrative fields of a household-track Stabilization Map.",
      parameters: {
        type: "OBJECT",
        properties: {
          situation_summary: { type: "STRING" },
          urgency_flag: { type: "STRING" },
          action_plan_phase_1: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: { title: { type: "STRING" }, detail: { type: "STRING" } },
              required: ["title", "detail"],
            },
          },
          action_plan_phase_2: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: { title: { type: "STRING" }, detail: { type: "STRING" } },
              required: ["title", "detail"],
            },
          },
          action_plan_phase_3: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: { title: { type: "STRING" }, detail: { type: "STRING" } },
              required: ["title", "detail"],
            },
          },
        },
        required: [
          "situation_summary",
          "urgency_flag",
          "action_plan_phase_1",
          "action_plan_phase_2",
          "action_plan_phase_3",
        ],
      },
    },
  ],
};

interface HouseholdContext {
  anchorTransferAmount: number | null;
  anchorTransferAmountNote: string | null;
  spousalAlignmentScore: number | null;
  spousalAlignmentNote: string | null;
  pressureTypes: string[] | null;
  pressureNote: string | null;
  pendingCapexAmount: number | null;
  pendingCapexDate: string | null;
  pendingCapexDescription: string | null;
  legacyAdvisorFrictionNotes: string | null;
}

function factsBlock(
  householdLabel: string,
  familyName: string,
  wealthEventType: string,
  wealthEventNotes: string,
  diagnostics: any,
  isLegacyClient: boolean,
  visionValues?: { vision: string; values: string; purpose: string },
  householdContext?: HouseholdContext,
  causalRiskLines?: string[],
  georgiaLines?: string[],
): string {
  const lines = [`Household: ${householdLabel} (${familyName})`];
  if (isLegacyClient) {
    lines.push(
      "Engagement stage: Existing managed client formalizing their Sovereignty Operating System — NOT a new-lead onboarding. Do not frame this as an initial/Day-1 engagement.",
    );
    // Existing clients don't have a triggering "wealth event" — their guided
    // intake instead captures vision, values, and purpose for their capital
    // as 3 separate fields.
    if (visionValues?.vision) lines.push(`Client's stated vision for their family's future: ${visionValues.vision}`);
    if (visionValues?.values) lines.push(`Client's stated values guiding their decisions: ${visionValues.values}`);
    if (visionValues?.purpose) lines.push(`Client's stated purpose for their capital: ${visionValues.purpose}`);
  } else {
    lines.push(`Wealth event: ${wealthEventType || "(not specified)"}`);
    lines.push(`Wealth event notes: ${wealthEventNotes || "(none provided)"}`);
  }
  // Household Context — new-lead, personal sudden-wealth events only (never
  // populated for legacy clients or corporate wealth events, so every field
  // is optional here and simply omitted when absent).
  if (householdContext) {
    const hc = householdContext;
    if (hc.anchorTransferAmount != null) {
      lines.push(
        `Client's anchor transfer amount (the figure they're anchored to for this transfer): $${Math.round(hc.anchorTransferAmount).toLocaleString()}${hc.anchorTransferAmountNote ? ` — ${hc.anchorTransferAmountNote}` : ""}`,
      );
    }
    if (hc.spousalAlignmentScore != null) {
      lines.push(
        `Spousal/partner alignment on financial decisions (self-reported, 1-5 scale): ${hc.spousalAlignmentScore}/5${hc.spousalAlignmentNote ? ` — ${hc.spousalAlignmentNote}` : ""}`,
      );
    }
    if (hc.pressureTypes && hc.pressureTypes.length > 0) {
      lines.push(
        `Outside pressures on their decisions: ${hc.pressureTypes.join(", ")}${hc.pressureNote ? ` — ${hc.pressureNote}` : ""}`,
      );
    }
    if (hc.pendingCapexAmount != null) {
      const daysAway = hc.pendingCapexDate
        ? Math.round((new Date(hc.pendingCapexDate).getTime() - Date.now()) / (24 * 60 * 60 * 1000))
        : null;
      const timing = hc.pendingCapexDate
        ? ` planned for ${hc.pendingCapexDate}${daysAway != null ? ` (${daysAway >= 0 ? `${daysAway} days away` : `${Math.abs(daysAway)} days ago`})` : ""}`
        : "";
      lines.push(
        `Pending capital expenditure: $${Math.round(hc.pendingCapexAmount).toLocaleString()}${timing}${hc.pendingCapexDescription ? ` — ${hc.pendingCapexDescription}` : ""}`,
      );
    }
    if (hc.legacyAdvisorFrictionNotes) {
      lines.push(`Friction with a previous advisor: ${hc.legacyAdvisorFrictionNotes}`);
    }
  }
  lines.push(`Track type: ${diagnostics.track_type}`);
  lines.push(
    `Total investable assets (AUM): $${Math.round(diagnostics.aum).toLocaleString()}`,
    `Document readiness: ${diagnostics.document_readiness.criticalSatisfied}/${diagnostics.document_readiness.criticalTotal} required documents filed (${diagnostics.document_readiness.percent}%)`,
    `Asset protection (total insurance coverage on file): $${Math.round(diagnostics.insurance_coverage_total ?? 0).toLocaleString()}`,
  );
  if (diagnostics.document_readiness.missingCritical?.length) {
    lines.push(`Missing required documents: ${diagnostics.document_readiness.missingCritical.join(", ")}`);
  }
  if (diagnostics.track_type === "corporate") {
    if (typeof diagnostics.sbd_clawback === "number") {
      lines.push(`Small Business Deduction clawback exposure: $${Math.round(diagnostics.sbd_clawback).toLocaleString()}`);
    }
    if (diagnostics.active_asset_ratio) {
      lines.push(
        `Active asset ratio: ${Math.round(diagnostics.active_asset_ratio.ratio * 100)}% (${diagnostics.active_asset_ratio.belowLcgeThreshold ? "BELOW the 90% LCGE eligibility threshold — needs purification" : "meets the 90% LCGE eligibility threshold"})`,
      );
    }
    if (diagnostics.usa_staleness) {
      lines.push(
        `Unanimous Shareholder Agreement: ${diagnostics.usa_staleness.onFile ? `on file, last reviewed ${diagnostics.usa_staleness.ageYears} years ago` : "not on file"} — ${diagnostics.usa_staleness.isStale ? "STALE, needs review" : "current"}`,
      );
    }
  }
  if (diagnostics.estate_hygiene) {
    lines.push(
      `Estate hygiene — Will: ${diagnostics.estate_hygiene.will_status || "unknown"}, POA: ${diagnostics.estate_hygiene.poa_status || "unknown"}, Beneficiary coordination: ${diagnostics.estate_hygiene.beneficiary_coordination_status || "unknown"}`,
    );
  }
  if (causalRiskLines && causalRiskLines.length > 0) {
    lines.push(...causalRiskLines);
  }
  if (georgiaLines && georgiaLines.length > 0) {
    lines.push(...georgiaLines);
  }
  return lines.join("\n");
}

// ---------- Causal AI Platform integration (Phase 3) ----------
// The Ontology assessment and its Causal DAG flags are handed to the model
// as read-only facts, exactly like every other diagnostic in this file --
// evaluateCausalDag() itself is still pure deterministic math, never the
// AI. Only the flag NAMES/actions (already advisor-friendly labels, e.g.
// "Legacy Asset Liquidation Paralysis") are safe for the model to
// reference in prose -- the underlying raw scores/field paths are for
// context only, never to be quoted back; see HOUSEHOLD_EXTRACTION_PROMPT's
// own rule for the instruction that enforces this.
function causalRiskFactsLines(assessment: OntologyAssessmentPayload | null, flags: RiskFlag[]): string[] {
  if (!assessment) return [];
  const lines: string[] = [];
  const fin = assessment.financial_state;
  const rel = assessment.relational_state;
  const emo = assessment.emotional_state;
  const spokeParts: string[] = [];
  if (fin?.financial_literacy_score != null) spokeParts.push(`financial literacy self-assessed ${fin.financial_literacy_score}/10`);
  if (fin?.tax_liability_identified != null) spokeParts.push(`tax liability identified: ${fin.tax_liability_identified ? "yes" : "no"}`);
  if (fin?.existing_fiduciary_team != null) spokeParts.push(`existing fiduciary team in place: ${fin.existing_fiduciary_team ? "yes" : "no"}`);
  if (rel?.spousal_alignment_score != null) spokeParts.push(`spousal/partner alignment ${rel.spousal_alignment_score}/10`);
  if (rel?.begging_hand_pressure_index) spokeParts.push(`outside pressure from others for access to funds: ${rel.begging_hand_pressure_index}`);
  if (rel?.secrecy_isolation_score != null) spokeParts.push(`secrecy/isolation around the money ${rel.secrecy_isolation_score}/10`);
  if (emo?.guilt_survivor_index != null) spokeParts.push(`guilt/survivor feelings about receiving this capital ${emo.guilt_survivor_index}/10`);
  if (emo?.imposter_syndrome_score != null) spokeParts.push(`imposter syndrome ${emo.imposter_syndrome_score}/10`);
  if (emo?.decision_behavior_type) spokeParts.push(`decision behavior tendency: ${emo.decision_behavior_type}`);
  if (emo?.psychological_stage_goldbart) spokeParts.push(`psychological stage: ${emo.psychological_stage_goldbart.replace(/_/g, " ")}`);
  if (emo?.transition_phase_bradley) spokeParts.push(`transition phase: ${emo.transition_phase_bradley.replace(/_/g, " ")}`);
  if (spokeParts.length > 0) {
    lines.push(`Causal AI Ontology assessment (staff-entered, most recent on file): ${spokeParts.join("; ")}.`);
  }
  if (flags.length > 0) {
    lines.push(
      `Active Causal Risk Flags: ${flags.map((f) => `${f.risk_name} (${f.severity}) — recommended action: ${f.action}`).join(" | ")}`,
    );
  }
  return lines;
}

// ---------- Household-track generation handler ----------

async function handleHouseholdGeneration(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  householdId: string,
  mapId: string | undefined,
  staffUserId: string | null,
  corsHeaders: Record<string, string>,
): Promise<Response> {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const { data: household, error: hhErr } = await supabase
    .from("households")
    .select(
      "id, wealth_event_type, wealth_event_notes, vision_notes, values_notes, purpose_notes, anchor_transfer_amount, anchor_transfer_amount_note, spousal_alignment_score, spousal_alignment_note, pressure_types, pressure_note, pending_capex_amount, pending_capex_date, pending_capex_description, legacy_advisor_friction_notes",
    )
    .eq("id", householdId)
    .maybeSingle();
  if (hhErr || !household) return json({ error: "Household not found" }, 404);

  const { data: contacts } = await supabase
    .from("contacts")
    .select("id, first_name, last_name, family_role")
    .eq("household_id", householdId);
  const roleRank = (r: string | null | undefined) => {
    const v = (r || "").toLowerCase();
    if (v === "hof" || v === "head_of_family" || v.includes("head of family")) return 0;
    if (v === "hoh" || v === "head_of_household" || v.includes("head of household")) return 1;
    return 2;
  };
  const primaryContact = [...(contacts ?? [])].sort(
    (a: any, b: any) => roleRank(a.family_role) - roleRank(b.family_role),
  )[0];

  // Find or seed the map row, preserving any advisor-entered diagnostic_inputs across regenerations.
  let existingMapId = mapId;
  let existingInputs: DiagnosticInputs = {};
  if (!existingMapId) {
    const { data: existingForHousehold } = await supabase
      .from("stabilization_maps")
      .select("id, diagnostic_inputs")
      .eq("household_id", householdId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existingForHousehold?.id) {
      existingMapId = existingForHousehold.id;
      existingInputs = existingForHousehold.diagnostic_inputs ?? {};
    }
  } else {
    const { data: existing } = await supabase
      .from("stabilization_maps")
      .select("diagnostic_inputs")
      .eq("id", existingMapId)
      .maybeSingle();
    existingInputs = existing?.diagnostic_inputs ?? {};
  }

  if (!existingMapId) {
    const { data: inserted, error: insErr } = await supabase
      .from("stabilization_maps")
      .insert({
        household_id: householdId,
        client_first_name: primaryContact?.first_name || "",
        client_last_name: primaryContact?.last_name || "",
        session_date: new Date().toISOString().slice(0, 10),
        event_type: household.wealth_event_type || "",
        generation_status: "generating",
      })
      .select("id")
      .single();
    if (insErr || !inserted) return json({ error: "Failed to create map record" }, 500);
    existingMapId = inserted.id;
  } else {
    await supabase
      .from("stabilization_maps")
      .update({
        client_first_name: primaryContact?.first_name || "",
        client_last_name: primaryContact?.last_name || "",
        generation_status: "generating",
        generation_error: null,
      })
      .eq("id", existingMapId);
  }

  try {
    const { track_type, diagnostics, financials } = await computeSovereigntyDiagnostics(
      supabase,
      householdId,
      existingInputs,
    );
    const isLegacyClient = financials.isLegacyClient;

    const { data: latestOntology } = await supabase
      .from("household_ontology_assessments")
      .select("financial_state, relational_state, emotional_state, event_spoke_type, event_spoke_data")
      .eq("household_id", householdId)
      .order("assessment_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const causalFlags = latestOntology ? evaluateCausalDag(latestOntology as OntologyAssessmentPayload) : [];
    const causalRiskLines = causalRiskFactsLines(latestOntology as OntologyAssessmentPayload | null, causalFlags);

    // The client's Georgia diagnostic, matched by any household member's
    // email (so it also works for an existing contact, not just a household
    // created from the lead). Best-effort context; never blocks generation.
    let georgiaLines: string[] = [];
    try {
      const { data: memberRows } = await supabase.from("contacts").select("email").eq("household_id", householdId);
      const emails = (memberRows ?? []).map((m: any) => m.email).filter((e: unknown): e is string => !!e);
      if (emails.length > 0) {
        const filter = emails.map((e: string) => `email.ilike."${e.replace(/"/g, "")}"`).join(",");
        const { data: georgiaLead } = await supabase
          .from("georgia2_leads")
          .select("catalyst, answers, diagnostic_payload, risk_scores_calculated")
          .or(filter)
          .order("submitted_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        georgiaLines = georgiaFactLines(georgiaLead as GeorgiaLeadFacts | null);
      }
    } catch (e) {
      console.warn("[stabilization-map-generate] Georgia diagnostic lookup failed (non-fatal):", e);
    }

    const gcpKeyRaw = Deno.env.get("GCP_SERVICE_ACCOUNT_KEY");
    if (!gcpKeyRaw) throw new Error("GCP_SERVICE_ACCOUNT_KEY not configured");
    const sa: ServiceAccountKey = JSON.parse(gcpKeyRaw);
    const accessToken = await getAccessToken(sa);
    const vertexUrl =
      `https://${REGION}-aiplatform.googleapis.com/v1/projects/${sa.project_id}/locations/${REGION}/publishers/google/models/${MODEL}:generateContent`;

    const facts = factsBlock(
      diagnostics.household_label,
      diagnostics.family_name,
      household.wealth_event_type || "",
      household.wealth_event_notes || "",
      diagnostics,
      isLegacyClient,
      {
        vision: household.vision_notes || "",
        values: household.values_notes || "",
        purpose: household.purpose_notes || "",
      },
      {
        anchorTransferAmount: household.anchor_transfer_amount,
        anchorTransferAmountNote: household.anchor_transfer_amount_note,
        spousalAlignmentScore: household.spousal_alignment_score,
        spousalAlignmentNote: household.spousal_alignment_note,
        pressureTypes: household.pressure_types,
        pressureNote: household.pressure_note,
        pendingCapexAmount: household.pending_capex_amount,
        pendingCapexDate: household.pending_capex_date,
        pendingCapexDescription: household.pending_capex_description,
        legacyAdvisorFrictionNotes: household.legacy_advisor_friction_notes,
      },
      causalRiskLines,
      georgiaLines,
    );

    const aiRes = await fetch(vertexUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({
        contents: [
          { role: "user", parts: [{ text: HOUSEHOLD_EXTRACTION_PROMPT }] },
          { role: "model", parts: [{ text: "Understood. Provide the household facts and I will draft the narrative." }] },
          { role: "user", parts: [{ text: facts }] },
        ],
        tools: [HOUSEHOLD_TOOL_SCHEMA],
        toolConfig: {
          functionCallingConfig: { mode: "ANY", allowedFunctionNames: ["populate_household_stabilization_map"] },
        },
        generationConfig: { temperature: 0.3, maxOutputTokens: 8192 },
      }),
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      console.error(`[stabilization-map-generate] household Vertex error ${aiRes.status}:`, errText);
      await supabase.from("stabilization_maps")
        .update({ generation_status: "failed", generation_error: `Vertex AI ${aiRes.status}` })
        .eq("id", existingMapId);
      return json({ error: "AI generation failed", mapId: existingMapId }, 502);
    }

    const result = await aiRes.json();
    const parts = result.candidates?.[0]?.content?.parts || [];
    const fnCall = parts.find((p: any) => p.functionCall)?.functionCall;
    if (!fnCall || !fnCall.args) {
      await supabase.from("stabilization_maps")
        .update({ generation_status: "failed", generation_error: "AI did not return structured data" })
        .eq("id", existingMapId);
      return json({ error: "AI did not return structured data", mapId: existingMapId }, 502);
    }

    const args = fnCall.args;
    const cleanBullets = (arr: unknown): { title: string; detail: string }[] =>
      Array.isArray(arr)
        ? arr
            .filter((b: any) => b && typeof b === "object")
            .map((b: any) => ({ title: String(b.title || "").slice(0, 80), detail: String(b.detail || "").slice(0, 300) }))
            .slice(0, 6)
        : [];

    const update = {
      household_id: householdId,
      track_type,
      diagnostics,
      event_type: household.wealth_event_type || "",
      action_plan: {
        phase_1: cleanBullets(args.action_plan_phase_1),
        phase_2: cleanBullets(args.action_plan_phase_2),
        phase_3: cleanBullets(args.action_plan_phase_3),
      },
      situation_summary: String(args.situation_summary || "").slice(0, 1200),
      urgency_flag: String(args.urgency_flag || "").slice(0, 1200),
      generation_status: "ready",
      generation_error: null,
    };

    const { error: updErr } = await supabase.from("stabilization_maps").update(update).eq("id", existingMapId);
    if (updErr) throw updErr;

    if (primaryContact?.id) {
      try {
        await supabase.from("sovereignty_audit_trail").insert({
          contact_id: primaryContact.id,
          user_id: staffUserId,
          action_type: "stabilization_map_household_generate",
          action_description: `Sovereignty Survey Stabilization Map generated for household ${householdId}`,
          proposed_data: { mapId: existingMapId, householdId, track_type },
        });
      } catch (e) {
        console.warn("[stabilization-map-generate] household audit-trail insert failed", e);
      }
    }

    return json({ success: true, mapId: existingMapId });
  } catch (e) {
    console.error("[stabilization-map-generate] household generation error:", e);
    await supabase.from("stabilization_maps")
      .update({ generation_status: "failed", generation_error: e instanceof Error ? e.message : "Unknown error" })
      .eq("id", existingMapId);
    return json({ error: e instanceof Error ? e.message : "Unknown error", mapId: existingMapId }, 500);
  }
}

// ---------- Main ----------

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Auth: require either service-role bearer (internal calls) or @prosperwise.ca staff JWT.
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    let staffUserId: string | null = null;
    if (!token) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (token !== serviceKey) {
      const supabaseUserClient = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: `Bearer ${token}` } } }
      );
      const { data: userData, error: userErr } = await supabaseUserClient.auth.getUser();
      const email = userData?.user?.email?.toLowerCase() || "";
      if (userErr || !userData?.user || !email.endsWith("@prosperwise.ca")) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      staffUserId = userData.user.id;
    }

    const body = await req.json();
    const { leadId, mapId, contactId, householdId } = body as {
      leadId?: string; mapId?: string; contactId?: string; householdId?: string;
    };

    if (!leadId && !mapId && !contactId && !householdId) {
      return new Response(
        JSON.stringify({ error: "leadId, contactId, householdId, or mapId is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      serviceKey,
    );

    // ---- Household-track (Sovereignty Survey) branch — entirely separate from
    // the lead/contact narrative-extraction flow below. ----
    let resolvedHouseholdId = householdId;
    if (mapId && !resolvedHouseholdId) {
      const { data: existing } = await supabase
        .from("stabilization_maps")
        .select("household_id")
        .eq("id", mapId)
        .maybeSingle();
      resolvedHouseholdId = existing?.household_id || undefined;
    }

    if (resolvedHouseholdId) {
      return await handleHouseholdGeneration(supabase, resolvedHouseholdId, mapId, staffUserId, corsHeaders);
    }

    // Resolve the lead (from either leadId, mapId, or contactId)
    let resolvedLeadId = leadId;
    let existingMapId = mapId;

    if (mapId && !resolvedLeadId) {
      const { data: existing } = await supabase
        .from("stabilization_maps")
        .select("lead_id")
        .eq("id", mapId)
        .maybeSingle();
      resolvedLeadId = existing?.lead_id || undefined;
    }

    // If only contactId provided, find existing map (or seed one from the contact directly)
    if (!resolvedLeadId && !existingMapId && contactId) {
      const { data: existingForContact } = await supabase
        .from("stabilization_maps")
        .select("id, lead_id")
        .eq("contact_id", contactId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existingForContact?.id) {
        existingMapId = existingForContact.id;
        resolvedLeadId = existingForContact.lead_id || undefined;
      }

      // No map yet? Bootstrap from contact data without requiring a lead
      if (!existingMapId) {
        const { data: contact } = await supabase
          .from("contacts")
          .select("first_name, last_name")
          .eq("id", contactId)
          .single();
        if (!contact) {
          return new Response(
            JSON.stringify({ error: "Contact not found" }),
            { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
        const { data: inserted, error: insErr } = await supabase
          .from("stabilization_maps")
          .insert({
            contact_id: contactId,
            client_first_name: contact.first_name || "",
            client_last_name: contact.last_name || "",
            session_date: new Date().toISOString().slice(0, 10),
            generation_status: "ready",
            situation_summary: "Manually authored — no lead intake on file. Edit fields directly.",
          })
          .select("id")
          .single();
        if (insErr || !inserted) throw new Error("Failed to seed map for contact");
        return new Response(
          JSON.stringify({ success: true, mapId: inserted.id, seeded: true }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    if (!resolvedLeadId) {
      return new Response(
        JSON.stringify({ error: "Lead not found for this map" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { data: lead, error: leadError } = await supabase
      .from("discovery_leads")
      .select("*")
      .eq("id", resolvedLeadId)
      .single();

    if (leadError || !lead) {
      return new Response(
        JSON.stringify({ error: "Lead not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Parse first/last name
    const rawName = (lead.first_name || "").trim();
    const nameParts = rawName.split(/\s+/);
    const clientFirstName = nameParts[0] || rawName;
    const clientLastName = nameParts.slice(1).join(" ") || "";

    // Upsert the map row as pending (so the UI can reflect state)
    if (!existingMapId) {
      // Check if one already exists for this lead
      const { data: existingForLead } = await supabase
        .from("stabilization_maps")
        .select("id")
        .eq("lead_id", resolvedLeadId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      existingMapId = existingForLead?.id;
    }

    if (!existingMapId) {
      const { data: inserted, error: insErr } = await supabase
        .from("stabilization_maps")
        .insert({
          lead_id: resolvedLeadId,
          client_first_name: clientFirstName,
          client_last_name: clientLastName,
          session_date: new Date().toISOString().slice(0, 10),
          generation_status: "generating",
        })
        .select("id")
        .single();
      if (insErr || !inserted) throw new Error("Failed to create map record");
      existingMapId = inserted.id;
    } else {
      await supabase
        .from("stabilization_maps")
        .update({
          client_first_name: clientFirstName,
          client_last_name: clientLastName,
          generation_status: "generating",
          generation_error: null,
        })
        .eq("id", existingMapId);
    }

    // Build extraction user message
    const intake = [
      `Client first name: ${clientFirstName}`,
      `Transition type: ${lead.transition_type || "(not specified)"}`,
      `Anxiety anchor: ${lead.anxiety_anchor || "(not specified)"}`,
      `Vision summary: ${lead.vision_summary || "(not specified)"}`,
      `Vineyard summary: ${lead.vineyard_summary || "(not specified)"}`,
      `Discovery notes: ${lead.discovery_notes || "(not specified)"}`,
    ].join("\n");

    // Call Vertex AI
    const gcpKeyRaw = Deno.env.get("GCP_SERVICE_ACCOUNT_KEY");
    if (!gcpKeyRaw) throw new Error("GCP_SERVICE_ACCOUNT_KEY not configured");
    const sa: ServiceAccountKey = JSON.parse(gcpKeyRaw);
    const accessToken = await getAccessToken(sa);

    const vertexUrl =
      `https://${REGION}-aiplatform.googleapis.com/v1/projects/${sa.project_id}/locations/${REGION}/publishers/google/models/${MODEL}:generateContent`;

    console.log(`[stabilization-map-generate] Calling Vertex AI for lead ${resolvedLeadId}`);

    const aiRes = await fetch(vertexUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({
        contents: [
          { role: "user", parts: [{ text: EXTRACTION_PROMPT }] },
          { role: "model", parts: [{ text: "Understood. Provide the intake and I will populate the map." }] },
          { role: "user", parts: [{ text: intake }] },
        ],
        tools: [TOOL_SCHEMA],
        toolConfig: {
          functionCallingConfig: { mode: "ANY", allowedFunctionNames: ["populate_stabilization_map"] },
        },
        generationConfig: { temperature: 0.3, maxOutputTokens: 2048 },
      }),
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      console.error(`[stabilization-map-generate] Vertex error ${aiRes.status}:`, errText);
      await supabase
        .from("stabilization_maps")
        .update({ generation_status: "failed", generation_error: `Vertex AI ${aiRes.status}` })
        .eq("id", existingMapId!);
      return new Response(
        JSON.stringify({ error: "AI generation failed", mapId: existingMapId }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const result = await aiRes.json();
    const parts = result.candidates?.[0]?.content?.parts || [];
    const fnCall = parts.find((p: any) => p.functionCall)?.functionCall;

    if (!fnCall || !fnCall.args) {
      console.error("[stabilization-map-generate] No function call returned", JSON.stringify(result).slice(0, 500));
      await supabase
        .from("stabilization_maps")
        .update({ generation_status: "failed", generation_error: "AI did not return structured data" })
        .eq("id", existingMapId!);
      return new Response(
        JSON.stringify({ error: "AI did not return structured data", mapId: existingMapId }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const args = fnCall.args;

    // Enum guards
    const normEnum = (val: string, allowed: string[], fallback: string) =>
      allowed.includes(val) ? val : fallback;

    const update = {
      event_type: normEnum(
        args.event_type,
        ["Business Exit", "Inheritance", "Sudden Windfall", "Taxable Event"],
        "Business Exit",
      ),
      situation_summary: String(args.situation_summary || "").slice(0, 1200),
      urgency_flag: String(args.urgency_flag || "").slice(0, 1200),
      risk_1: String(args.risk_1 || "").slice(0, 200),
      risk_2: String(args.risk_2 || "").slice(0, 200),
      risk_3: String(args.risk_3 || "").slice(0, 200),
      risk_4: String(args.risk_4 || "").slice(0, 200),
      risk_5: String(args.risk_5 || "").slice(0, 200),
      next_step_1: String(args.next_step_1 || "").slice(0, 200),
      next_step_2: String(args.next_step_2 || "").slice(0, 200),
      next_step_3: String(args.next_step_3 || "").slice(0, 200),
      next_step_4: String(args.next_step_4 || "").slice(0, 200),
      next_step_5: String(args.next_step_5 || "").slice(0, 200),
      storehouse_status: normEnum(
        args.storehouse_status,
        ["Not Established", "Partial", "Established"],
        "Not Established",
      ),
      storehouse_detail: String(args.storehouse_detail || "").slice(0, 500),
      solicitation_status: normEnum(
        args.solicitation_status,
        ["Not Established", "Partial", "Established"],
        "Not Established",
      ),
      solicitation_detail: String(args.solicitation_detail || "").slice(0, 500),
      sovereignty_charter_status: normEnum(
        args.sovereignty_charter_status,
        ["Not Started", "In Progress", "Complete"],
        "Not Started",
      ),
      sovereignty_charter_detail: String(args.sovereignty_charter_detail || "").slice(0, 500),
      tax_status: normEnum(
        args.tax_status,
        ["Not Assessed", "In Progress", "Assessed"],
        "Not Assessed",
      ),
      tax_detail: String(args.tax_detail || "").slice(0, 500),
      logic_trace: String(args.logic_trace || "").slice(0, 4000),
      generation_status: "ready",
      generation_error: null,
    };

    const { error: updErr } = await supabase
      .from("stabilization_maps")
      .update(update)
      .eq("id", existingMapId!);

    if (updErr) {
      console.error("[stabilization-map-generate] Update error:", updErr);
      throw updErr;
    }

    return new Response(
      JSON.stringify({ success: true, mapId: existingMapId }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("stabilization-map-generate error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
