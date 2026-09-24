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
    const { data: assessments, error } = await db
      .from("household_ontology_assessments")
      .select(ASSESSMENT_FIELDS)
      .eq("household_id", householdId)
      .order("assessment_date", { ascending: false })
      .order("created_at", { ascending: false });
    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const latest = assessments?.[0] ?? null;
    const flags = latest ? evaluateCausalDag(latest as OntologyAssessmentPayload) : [];
    return new Response(JSON.stringify({ ok: true, assessments: assessments ?? [], latest, flags }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
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

  return new Response(JSON.stringify({ error: `Unknown action: ${String(action)}` }), {
    status: 400,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
