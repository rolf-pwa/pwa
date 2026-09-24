// delta-engine-reconcile — the LLM Delta Analysis Engine from the Causal AI
// Platform blueprint (architectural-blueprint-document.md §5). Compares a
// household's self-reported Hub & Spoke Ontology baseline (Phase 1)
// against a real, already-synced meeting transcript
// (household_charters.meeting_transcripts, built for the Charter v2.0
// wizard — reused here read-only, not re-synced) and flags discrepancies.
// Staff-only, no DB writes: this only ever returns a proposal for the
// Delta Reconciliation Workbench to render — nothing here ever touches
// household_ontology_assessments directly, matching this codebase's
// "AI drafts, staff explicitly accepts and saves" discipline throughout.
//
// PII Shield runs on the transcript before it ever reaches Vertex (the 6th
// outbound path _shared/pii-shield.ts gates, after send-admin-email,
// engagement-message-send, portal-sms, quo-service, vault-service).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { generateVertexContent, parseServiceAccountKey, type ServiceAccountKey } from "../_shared/vertex-ai.ts";
import { checkOutboundPii } from "../_shared/pii-shield.ts";

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

interface MeetingTranscript {
  id: string;
  title: string;
  content_text: string;
  added_at: string;
}

// The only variable_paths the model is allowed to propose — matches
// _shared/causal-dag-evaluator.ts's Hub fields exactly (kept in sync
// manually, same discipline as that file's own header comment). Spoke
// paths are appended dynamically once the household's event_spoke_type is
// known, since which Spoke fields are valid depends on it.
const HUB_PATHS = [
  "financial_state.liquid_capital_cad",
  "financial_state.illiquid_capital_cad",
  "financial_state.monthly_burn_rate_cad",
  "financial_state.financial_literacy_score",
  "financial_state.tax_liability_identified",
  "financial_state.existing_fiduciary_team",
  "relational_state.spousal_alignment_score",
  "relational_state.begging_hand_pressure_index",
  "relational_state.secrecy_isolation_score",
  "relational_state.dependents_count",
  "emotional_state.ticker_shock_vulnerability",
  "emotional_state.decision_behavior_type",
  "emotional_state.guilt_survivor_index",
  "emotional_state.imposter_syndrome_score",
  "emotional_state.psychological_stage_goldbart",
  "emotional_state.transition_phase_bradley",
];

const SPOKE_PATHS: Record<string, string[]> = {
  inheritance: [
    "event_spoke_data.bereavement_stage",
    "event_spoke_data.blood_money_custodianship_score",
    "event_spoke_data.sibling_equity_friction_score",
    "event_spoke_data.executor_role_conflict",
    "event_spoke_data.legacy_asset_concentration_pct",
    "event_spoke_data.bc_probate_exposure",
  ],
  business_exit: [
    "event_spoke_data.identity_detachment_score",
    "event_spoke_data.daily_purpose_void_score",
    "event_spoke_data.builder_vs_steward_mindset",
    "event_spoke_data.need_for_control_score",
    "event_spoke_data.angel_investment_urgency_index",
    "event_spoke_data.earn_out_obligations",
  ],
  executive_retirement: [
    "event_spoke_data.company_stock_loyalty_score",
    "event_spoke_data.equity_concentration_pct",
    "event_spoke_data.corporate_status_deprivation_score",
    "event_spoke_data.tax_acceleration_vulnerability_index",
    "event_spoke_data.expense_account_decoupling_index",
  ],
  pre_exit_growth: [
    "event_spoke_data.paper_vs_liquid_ratio",
    "event_spoke_data.anticipation_phase_stage",
    "event_spoke_data.premature_commitment_index",
    "event_spoke_data.transaction_probability",
    "event_spoke_data.qsbs_or_estate_staging_completed",
  ],
};

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

  const auth = await requireStaff(req);
  if (auth.error) return json({ ok: false, error: auth.error }, 401);

  const body = await req.json().catch(() => ({}));
  const action = String(body?.action || "");
  const householdId = String(body?.household_id || "");
  if (!householdId) return json({ ok: false, error: "household_id is required" }, 400);

  const db = admin();

  if (action === "list_transcripts") {
    const { data: charter } = await db
      .from("household_charters")
      .select("meeting_transcripts")
      .eq("household_id", householdId)
      .maybeSingle();
    const transcripts: MeetingTranscript[] = charter?.meeting_transcripts || [];
    return json({
      ok: true,
      transcripts: transcripts.map((t) => ({ id: t.id, title: t.title, added_at: t.added_at })),
    });
  }

  if (action === "reconcile") {
    const transcriptId = String(body?.transcript_id || "");
    if (!transcriptId) return json({ ok: false, error: "transcript_id is required" }, 400);

    const [{ data: charter }, { data: household }, { data: assessments }] = await Promise.all([
      db.from("household_charters").select("meeting_transcripts").eq("household_id", householdId).maybeSingle(),
      db
        .from("households")
        .select(
          "anchor_transfer_amount, anchor_transfer_amount_note, spousal_alignment_score, spousal_alignment_note, pressure_types, pressure_note, legacy_advisor_friction_notes",
        )
        .eq("id", householdId)
        .maybeSingle(),
      db
        .from("household_ontology_assessments")
        .select("financial_state, relational_state, emotional_state, event_spoke_type, event_spoke_data")
        .eq("household_id", householdId)
        .order("assessment_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(1),
    ]);

    const transcripts: MeetingTranscript[] = charter?.meeting_transcripts || [];
    const transcript = transcripts.find((t) => t.id === transcriptId);
    if (!transcript) return json({ ok: false, error: "Transcript not found for this household" }, 404);

    const pii = checkOutboundPii(transcript.content_text || "");
    if (pii.blocked) {
      return json({ ok: false, error: `PII Shield blocked this transcript: ${pii.reason}` }, 422);
    }

    const baseline = assessments?.[0] || null;
    const spokeType = baseline?.event_spoke_type as string | null | undefined;
    const allowedPaths = [...HUB_PATHS, ...(spokeType && SPOKE_PATHS[spokeType] ? SPOKE_PATHS[spokeType] : [])];

    const baselineText = baseline
      ? `Financial state: ${JSON.stringify(baseline.financial_state || {})}
Relational state: ${JSON.stringify(baseline.relational_state || {})}
Emotional state: ${JSON.stringify(baseline.emotional_state || {})}
Event Spoke: ${baseline.event_spoke_type || "(not set)"} — ${JSON.stringify(baseline.event_spoke_data || {})}`
      : "(No Ontology assessment on file yet for this household.)";

    const householdContextText = household
      ? `Anchor transfer amount: ${household.anchor_transfer_amount ?? "(not given)"} — ${household.anchor_transfer_amount_note || ""}
Spousal alignment (1-5, self-reported at onboarding): ${household.spousal_alignment_score ?? "(not given)"} — ${household.spousal_alignment_note || ""}
Reported outside pressure: ${(household.pressure_types || []).join(", ") || "(none reported)"} — ${household.pressure_note || ""}
Legacy advisor friction notes: ${household.legacy_advisor_friction_notes || "(none)"}`
      : "(No onboarding context on file.)";

    const prompt = `You are the Delta Analysis Engine for a wealth advisory firm's Causal AI Platform. Your ONLY job is to compare a household's existing SELF-REPORTED baseline against what a real meeting transcript actually reveals, and flag genuine discrepancies. You are not a therapist and you do not diagnose — you are a careful reader comparing two sources.

SELF-REPORTED ONTOLOGY BASELINE (from the household's most recent staff assessment, or from their original intake diagnostic if no assessment exists yet):
${baselineText}

SELF-REPORTED ONBOARDING CONTEXT (collected directly from the household at the start of the relationship):
${householdContextText}

MEETING TRANSCRIPT ("${transcript.title}"):
${transcript.content_text}

Compare the transcript against the baseline above. For each variable_path listed below where the transcript reveals something that VARIES from, CONTRADICTS, or surfaces an UNSTATED RISK relative to the self-reported baseline, produce one delta. Do not produce a delta for a variable_path the transcript says nothing about. Do not invent a variable_path outside this list:
${allowedPaths.join("\n")}

For each delta, give TWO different things:
- observed_transcript_value: a plain-language description of what the transcript reveals, for a human reviewer to read.
- proposed_value: the actual value to store for that field, in the exact format the field expects — a bare number with no words for a 1-10 score field or a percentage/ratio/dollar field (e.g. "8", not "very high"), the exact string "true" or "false" for a yes/no field, or the exact matching enum label for a field with fixed options (e.g. "Critical", "Pure_Builder", "Acute_Grief") — never a sentence. If the transcript doesn't support a confident, specific proposed_value for a field (only a general impression), omit that delta rather than guessing at a number.

Every delta must include at least one verbatim supporting quote lifted directly from the transcript text above — never paraphrase the quote, and never fabricate a quote that doesn't appear verbatim in the transcript.

Return at most the 8 most significant deltas, ranked by delta_severity (Critical and High first). If more than 8 variable_paths show a real discrepancy, keep only the 8 most important — do not try to report everything, since a long response risks being cut off mid-generation.`;

    const DELTA_TOOL_SCHEMA = {
      functionDeclarations: [
        {
          name: "identify_causal_deltas",
          description: "Report discrepancies between the self-reported baseline and the meeting transcript.",
          parameters: {
            type: "OBJECT",
            properties: {
              deltas_detected: {
                type: "ARRAY",
                items: {
                  type: "OBJECT",
                  properties: {
                    variable_path: { type: "STRING" },
                    discrepancy_type: { type: "STRING", enum: ["Variance", "Contradiction", "Unstated_Risk"] },
                    self_reported_value: { type: "STRING" },
                    observed_transcript_value: { type: "STRING" },
                    proposed_value: { type: "STRING" },
                    delta_severity: { type: "STRING", enum: ["Low", "Moderate", "High", "Critical"] },
                    supporting_quotes: { type: "ARRAY", items: { type: "STRING" } },
                    clinical_rationale: { type: "STRING" },
                  },
                  required: [
                    "variable_path",
                    "discrepancy_type",
                    "observed_transcript_value",
                    "proposed_value",
                    "delta_severity",
                    "supporting_quotes",
                  ],
                },
              },
            },
            required: ["deltas_detected"],
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
        // 8192, not 4096 -- deltas_detected is an unbounded array (each
        // entry carries a rationale + several verbatim quotes), and a
        // dense transcript can legitimately produce enough of them to
        // exceed a smaller cap mid-generation, corrupting the function
        // call. Capped further by the prompt's own "at most 8 deltas"
        // instruction above, so this is real headroom, not a bet against
        // the same failure recurring on an even richer transcript.
        { temperature: 0.2, maxOutputTokens: 8192 },
        {
          tools: [DELTA_TOOL_SCHEMA],
          toolConfig: { functionCallingConfig: { mode: "ANY", allowedFunctionNames: ["identify_causal_deltas"] } },
        },
      );
    } catch (e) {
      return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
    }

    // deno-lint-ignore no-explicit-any
    const parts = result.candidates?.[0]?.content?.parts || [];
    // deno-lint-ignore no-explicit-any
    const fnCall = parts.find((p: any) => p.functionCall)?.functionCall;
    if (!fnCall?.args) return json({ ok: false, error: "The model did not return usable deltas." }, 500);

    return json({ ok: true, deltas: fnCall.args.deltas_detected || [], baseline });
  }

  return json({ ok: false, error: `Unknown action: ${action}` }, 400);
});
