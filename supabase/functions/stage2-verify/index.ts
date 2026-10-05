// stage2-verify — V2 Stage 2: deterministic verification of a Stage 1
// (LLM) extraction, plus the causal-model evaluation for the household.
// Staff-triggered; writes one row to stage2_verification_audit and never
// mutates live account/policy data. Gated by households.v2_ai_engine_enabled
// (409 if off) so V1 households behave exactly as before.
//
// Input: { householdId, kind: "investment" | "insurance", extraction,
//          documentId? } where `extraction` is the JSON Stage 1 produced and
// `documentId` is a vault_shoebox_proposals id when the file came from there.
//
// Named stage2-verify, not governance-verify: governance-verify already
// exists and verifies monthly governance-review snapshots, a different job.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { runStage2 } from "../_shared/stage2-run.ts";
import { logSystemHealth } from "../_shared/system-health.ts";

const ALLOWED_ORIGINS = [
  "https://prosperwise-portal.web.app",
  "https://prosperwise.lovable.app",
  "https://app.prosperwise.ca",
  "https://id-preview--339dfc8f-3e82-4b05-8a36-a9f66fc58449.lovable.app",
];

function getCorsHeaders(req: Request) {
  const origin = req.headers.get("Origin") || "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  let householdId: string | undefined;

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) return json({ error: "Unauthorized" }, 401);
    if (!user.email?.toLowerCase().endsWith("@prosperwise.ca")) return json({ error: "Access denied: unauthorized domain" }, 403);

    const body = await req.json().catch(() => null);
    householdId = body?.householdId;
    const { kind, extraction, documentId } = body ?? {};
    if (typeof householdId !== "string" || !UUID.test(householdId)) return json({ error: "householdId must be a uuid" }, 400);
    if (kind !== "investment" && kind !== "insurance") return json({ error: 'kind must be "investment" or "insurance"' }, 400);
    if (!extraction || typeof extraction !== "object") return json({ error: "extraction is required" }, 400);
    if (documentId !== undefined && (typeof documentId !== "string" || !UUID.test(documentId))) return json({ error: "documentId must be a uuid" }, 400);

    const { data: household } = await admin
      .from("households").select("id, v2_ai_engine_enabled").eq("id", householdId).maybeSingle();
    if (!household) return json({ error: "Household not found" }, 404);
    if (!household.v2_ai_engine_enabled) return json({ error: "V2 AI engine is not enabled for this household" }, 409);

    const result = await runStage2(admin, { householdId, kind, extraction, documentId });
    return json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[stage2-verify] error:", message);
    await logSystemHealth(admin, {
      function_name: "stage2-verify", severity: "ERROR", error_message: message,
      stack_trace: e instanceof Error ? e.stack : null, household_id: householdId && UUID.test(householdId) ? householdId : null,
    });
    return json({ error: "Internal error", details: message }, 500);
  }
});
