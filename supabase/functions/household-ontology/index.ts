// household-ontology — staff-only CRUD for the Causal AI Platform's Hub &
// Spoke Ontology (architectural-blueprint-document.md §4). Each save
// inserts a new dated assessment row (never overwrites) — this is a
// repeated-over-time record, matching the household_ontology_assessments
// migration's own stated design. Every response includes the deterministic
// Causal DAG flags for whichever assessment is returned, computed via
// _shared/causal-dag-evaluator.ts — pure math, no LLM involved anywhere in
// this function.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { evaluateCausalDag, type OntologyAssessmentPayload } from "../_shared/causal-dag-evaluator.ts";

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

const ASSESSMENT_FIELDS =
  "id, household_id, assessment_date, financial_state, relational_state, emotional_state, event_spoke_type, event_spoke_data, source_georgia2_lead_id, seeded_from, created_by, created_at, updated_at";

// Phase 2: households.causal_pipeline_status only ever moves forward.
// Plain ordinal list, not a DB enum -- matches this codebase's convention
// of validating evolving state concepts in code (see the migration's own
// comment for why LEAD_TRIAGED isn't representable here at all).
const PIPELINE_ORDER = ["survey_completed", "delta_reconciled", "charter_drafted", "hitl_locked", "vfo_active"];

async function advancePipelineStatus(db: ReturnType<typeof admin>, householdId: string, next: string): Promise<void> {
  const { data: household } = await db.from("households").select("causal_pipeline_status").eq("id", householdId).maybeSingle();
  const current = household?.causal_pipeline_status as string | null;
  const currentIdx = current ? PIPELINE_ORDER.indexOf(current) : -1;
  const nextIdx = PIPELINE_ORDER.indexOf(next);
  if (nextIdx === -1 || nextIdx <= currentIdx) return; // never regress, never set an unknown value
  await db.from("households").update({ causal_pipeline_status: next }).eq("id", householdId);
}

// Coerces a delta's proposed_value (always a string from the LLM tool
// call, distinct from its human-readable observed_transcript_value — see
// delta-engine-reconcile's own prompt for why those are two separate
// fields) back to the right JS type for storage — "true"/"false" ->
// boolean, a numeric string -> number, anything else stays a string
// (covers every enum/free-text field). A heuristic on purpose rather than
// a per-field type table: simpler, and doesn't need to be kept in sync
// with causal-dag-evaluator.ts's field list as that evolves.
function coerceDeltaValue(raw: string): string | number | boolean {
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (raw.trim() !== "" && !Number.isNaN(Number(raw))) return Number(raw);
  return raw;
}

function applyDeltaToPayload(
  payload: Record<string, unknown>,
  variablePath: string,
  rawValue: string,
): Record<string, unknown> {
  const [section, field] = variablePath.split(".");
  if (!section || !field) return payload;
  const next = { ...payload };
  const sectionObj = { ...((next[section] as Record<string, unknown>) || {}) };
  sectionObj[field] = coerceDeltaValue(rawValue);
  next[section] = sectionObj;
  return next;
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const staff = await requireStaff(req);
  if (staff.error) {
    return new Response(JSON.stringify({ error: staff.error }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const action = body.action;
  const householdId = typeof body.household_id === "string" ? body.household_id : null;
  if (!householdId) {
    return new Response(JSON.stringify({ error: "household_id is required" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const db = admin();

  if (action === "load") {
    const [{ data: assessments, error }, { data: household }] = await Promise.all([
      db
        .from("household_ontology_assessments")
        .select(ASSESSMENT_FIELDS)
        .eq("household_id", householdId)
        .order("assessment_date", { ascending: false })
        .order("created_at", { ascending: false }),
      db.from("households").select("causal_pipeline_status").eq("id", householdId).maybeSingle(),
    ]);
    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const latest = assessments?.[0] ?? null;
    const flags = latest ? evaluateCausalDag(latest as OntologyAssessmentPayload) : [];
    return new Response(
      JSON.stringify({
        ok: true,
        assessments: assessments ?? [],
        latest,
        flags,
        causal_pipeline_status: household?.causal_pipeline_status ?? null,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  if (action === "save") {
    const payload: OntologyAssessmentPayload = {
      financial_state: (body.financial_state as OntologyAssessmentPayload["financial_state"]) ?? null,
      relational_state: (body.relational_state as OntologyAssessmentPayload["relational_state"]) ?? null,
      emotional_state: (body.emotional_state as OntologyAssessmentPayload["emotional_state"]) ?? null,
      event_spoke_type: (body.event_spoke_type as OntologyAssessmentPayload["event_spoke_type"]) ?? null,
      event_spoke_data: (body.event_spoke_data as OntologyAssessmentPayload["event_spoke_data"]) ?? null,
    };

    const { data: inserted, error } = await db
      .from("household_ontology_assessments")
      .insert({
        household_id: householdId,
        financial_state: payload.financial_state,
        relational_state: payload.relational_state,
        emotional_state: payload.emotional_state,
        event_spoke_type: payload.event_spoke_type,
        event_spoke_data: payload.event_spoke_data,
        created_by: staff.userId,
      })
      .select(ASSESSMENT_FIELDS)
      .single();
    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const flags = evaluateCausalDag(payload);
    return new Response(JSON.stringify({ ok: true, assessment: inserted, flags }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Applies staff-accepted deltas from a Delta Reconciliation Workbench run
  // (delta-engine-reconcile's own output, never trusted un-reviewed) onto
  // the household's latest Ontology payload, inserts the result as a new
  // dated assessment (same "always insert, never overwrite" convention as
  // `save`), and advances the pipeline status. Every accepted delta was
  // an explicit staff click in the Workbench — nothing here evaluates or
  // applies anything the AI proposed on its own.
  if (action === "apply_deltas") {
    const acceptedDeltas = Array.isArray(body.accepted_deltas)
      ? (body.accepted_deltas as { variable_path: string; proposed_value: string }[])
      : [];
    if (acceptedDeltas.length === 0) {
      return new Response(JSON.stringify({ error: "No accepted deltas to apply" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: latestRows } = await db
      .from("household_ontology_assessments")
      .select(ASSESSMENT_FIELDS)
      .eq("household_id", householdId)
      .order("assessment_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1);
    const latest = latestRows?.[0] ?? null;

    let payload: Record<string, unknown> = {
      financial_state: latest?.financial_state ?? {},
      relational_state: latest?.relational_state ?? {},
      emotional_state: latest?.emotional_state ?? {},
      event_spoke_type: latest?.event_spoke_type ?? null,
      event_spoke_data: latest?.event_spoke_data ?? {},
    };
    for (const delta of acceptedDeltas) {
      if (!delta?.variable_path) continue;
      payload = applyDeltaToPayload(payload, delta.variable_path, String(delta.proposed_value ?? ""));
    }

    const { data: inserted, error } = await db
      .from("household_ontology_assessments")
      .insert({
        household_id: householdId,
        financial_state: payload.financial_state,
        relational_state: payload.relational_state,
        emotional_state: payload.emotional_state,
        event_spoke_type: payload.event_spoke_type,
        event_spoke_data: payload.event_spoke_data,
        created_by: staff.userId,
      })
      .select(ASSESSMENT_FIELDS)
      .single();
    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await advancePipelineStatus(db, householdId, "delta_reconciled");

    const flags = evaluateCausalDag(payload as OntologyAssessmentPayload);
    return new Response(JSON.stringify({ ok: true, assessment: inserted, flags }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Explicit staff action locking the household's Ontology as reviewed —
  // the blueprint's HITL_LOCKED state. Just a pipeline-status advance, no
  // other side effect: there's no separate "lock" flag on the assessment
  // row itself, matching how this table has no concept of draft/final.
  if (action === "lock_and_ratify") {
    await advancePipelineStatus(db, householdId, "hitl_locked");
    return new Response(JSON.stringify({ ok: true, causal_pipeline_status: "hitl_locked" }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ error: `Unknown action: ${String(action)}` }), {
    status: 400,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
