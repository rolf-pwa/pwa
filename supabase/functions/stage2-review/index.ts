// stage2-review — advisor decisions on held V2 extractions
// (stage2_verification_audit rows with review_status = 'pending').
//   action "approve": optional advisor `corrections` are validated and
//     recorded in golden_dataset_overrides, Stage 2 is re-run on the
//     corrected data, and -- unless real conflicts remain and the advisor
//     hasn't acknowledged them -- the data is applied to live records.
//   action "reject": marks the row rejected; nothing is written to live data.
// Staff-only (@prosperwise.ca) and gated by households.v2_ai_engine_enabled.

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { checkInsurance, checkInvestment, verdictFor } from "../_shared/stage2-checks.ts";
import {
  applyCorrections, applyPlan, planInsuranceApply, planInvestmentApply, type Correction,
} from "../_shared/vault-apply.ts";
import { logSystemHealth } from "../_shared/system-health.ts";
import { logActionEvent } from "../_shared/action-brain.ts";

const ALLOWED_ORIGINS = [
  "https://prosperwise-portal.web.app",
  "https://prosperwise.lovable.app",
  "https://app.prosperwise.ca",
  "https://id-preview--339dfc8f-3e82-4b05-8a36-a9f66fc58449.lovable.app",
];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin") || "";
  const cors = {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  const url = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  let householdId: string | null = null;
  let auditId: string | undefined;
  let claimed = false;

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);
    const userClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) return json({ error: "Unauthorized" }, 401);
    if (!user.email?.toLowerCase().endsWith("@prosperwise.ca")) return json({ error: "Access denied: unauthorized domain" }, 403);

    const body = await req.json().catch(() => null);
    const action = body?.action;
    auditId = body?.auditId;
    if (typeof auditId !== "string" || !UUID.test(auditId)) return json({ error: "auditId must be a uuid" }, 400);
    if (action !== "approve" && action !== "reject") return json({ error: 'action must be "approve" or "reject"' }, 400);

    const { data: audit } = await admin.from("stage2_verification_audit").select("*").eq("id", auditId).maybeSingle();
    if (!audit) return json({ error: "Audit row not found" }, 404);
    householdId = audit.household_id;
    if (audit.review_status !== "pending") return json({ error: `Already ${audit.review_status}` }, 409);

    const { data: household } = await admin.from("households").select("id, v2_ai_engine_enabled").eq("id", audit.household_id).maybeSingle();
    if (!household?.v2_ai_engine_enabled) return json({ error: "V2 AI engine is not enabled for this household" }, 409);

    const now = new Date().toISOString();

    if (action === "reject") {
      const { data: done } = await admin.from("stage2_verification_audit")
        .update({ review_status: "rejected", reviewed_by: user.id, reviewed_at: now })
        .eq("id", auditId).eq("review_status", "pending").select("id");
      if (!done?.length) return json({ error: "Already reviewed" }, 409);
      await logActionEvent(admin, {
        household_id: audit.household_id, actor_id: user.id, actor_role: "ADVISOR", action_type: "stage2_reject", workflow_module: "vault_statement_scan",
        input_context_snapshot: { kind: audit.extracted_entities?.kind, overall_status: audit.overall_status, checks: (audit.arithmetic_checks ?? []).map((c: any) => ({ id: c.id, status: c.status })) },
        system_proposed_payload: audit.extracted_entities?.extraction, human_final_payload: { decision: "rejected" }, rejected: true,
        metadata: { audit_id: auditId },
      });
      return json({ audit_id: auditId, review_status: "rejected" });
    }

    // ---- approve ----
    const kind: "investment" | "insurance" = audit.extracted_entities?.kind;
    if (kind !== "investment" && kind !== "insurance") return json({ error: "Audit row has an unknown kind" }, 422);
    const source = audit.extracted_entities?.source ?? {};
    const listKey = kind === "investment" ? "accounts" : "policies";

    const corrections: Correction[] = Array.isArray(body.corrections) ? body.corrections : [];
    let corrected;
    try {
      corrected = applyCorrections(kind, audit.extracted_entities.extraction, corrections);
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : String(e) }, 400);
    }

    const checks = kind === "investment" ? checkInvestment(corrected.extraction) : checkInsurance(corrected.extraction);
    const verdict = verdictFor(checks, Array.isArray(corrected.extraction.missing_fields) ? corrected.extraction.missing_fields : []);
    if (verdict.overall_status === "CONFLICT" && body.acknowledgeConflicts !== true) {
      return json({ error: "Conflicts remain after corrections; correct them or acknowledge to apply anyway.", ...verdict, checks }, 422);
    }

    // Claim first so a double-click or second advisor can't apply twice.
    const { data: won } = await admin.from("stage2_verification_audit")
      .update({ review_status: "approved", reviewed_by: user.id, reviewed_at: now })
      .eq("id", auditId).eq("review_status", "pending").select("id");
    if (!won?.length) return json({ error: "Already reviewed" }, 409);
    claimed = true;

    if (corrected.overrides.length) {
      const { error: ovErr } = await admin.from("golden_dataset_overrides").insert(
        corrected.overrides.map((o) => ({ ...o, household_id: audit.household_id, advisor_id: user.id, document_id: audit.document_id })),
      );
      if (ovErr) throw new Error(`Recording overrides failed: ${ovErr.message}`);
    }

    const { data: members } = await admin.from("contacts").select("id, first_name, last_name, family_role").eq("household_id", audit.household_id);
    const memberIds = (members ?? []).map((m: any) => m.id);
    let plan;
    if (kind === "investment") {
      const [{ data: vineyard }, { data: storehouses }, { data: tank }] = await Promise.all([
        memberIds.length ? admin.from("vineyard_accounts").select("id, account_name, account_number").in("contact_id", memberIds) : { data: [] },
        memberIds.length ? admin.from("storehouses").select("id, label, asset_type").in("contact_id", memberIds) : { data: [] },
        memberIds.length ? admin.from("holding_tank").select("id, account_name, account_number").in("contact_id", memberIds).neq("status", "moved") : { data: [] },
      ]);
      plan = planInvestmentApply(corrected.extraction[listKey] ?? [], {
        householdId: audit.household_id, members: members ?? [], vineyard: vineyard ?? [], storehouses: storehouses ?? [], holdingTank: tank ?? [],
        sourceFile: source.drive_id ? `vault:${source.drive_id}:${source.file_name ?? ""}` : null,
      });
    } else {
      const { data: shareholders } = memberIds.length
        ? await admin.from("shareholders").select("corporation_id").in("contact_id", memberIds).eq("is_active", true) : { data: [] };
      const corpIds = [...new Set((shareholders ?? []).map((s: any) => s.corporation_id))];
      const { data: corporations } = corpIds.length ? await admin.from("corporations").select("id, name").in("id", corpIds) : { data: [] };
      const { data: policies } = await admin.from("insurance_policies").select("id, carrier, policy_number, insured_name")
        .or(`contact_id.in.(${memberIds.length ? memberIds.join(",") : "00000000-0000-0000-0000-000000000000"})${corpIds.length ? `,corporation_id.in.(${corpIds.join(",")})` : ""}`);
      plan = planInsuranceApply(corrected.extraction[listKey] ?? [], {
        members: members ?? [], corporations: corporations ?? [], policies: policies ?? [], vaultFolderId: null, fileName: source.file_name ?? null,
      });
    }

    const result = await applyPlan(admin, plan);
    await admin.from("stage2_verification_audit")
      .update({ applied_at: new Date().toISOString(), apply_result: { ...result, overrides: corrected.overrides.length, acknowledged_conflicts: verdict.overall_status === "CONFLICT" } })
      .eq("id", auditId);
    await logActionEvent(admin, {
      household_id: audit.household_id, actor_id: user.id, actor_role: "ADVISOR", action_type: "stage2_approve", workflow_module: "vault_statement_scan",
      input_context_snapshot: { kind, overall_status: audit.overall_status, checks: (audit.arithmetic_checks ?? []).map((c: any) => ({ id: c.id, status: c.status })) },
      system_proposed_payload: audit.extracted_entities.extraction, human_final_payload: corrected.extraction,
      metadata: { audit_id: auditId, overrides: corrected.overrides.length, acknowledged_conflicts: verdict.overall_status === "CONFLICT" },
    });
    return json({ audit_id: auditId, review_status: "approved", overall_status: verdict.overall_status, ...result, overrides: corrected.overrides.length });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[stage2-review] error:", message);
    // A failed apply goes back to pending so the advisor can retry; matching is
    // by account/policy identity, so already-written rows are updated, not duplicated.
    if (claimed && auditId) {
      await admin.from("stage2_verification_audit")
        .update({ review_status: "pending", reviewed_by: null, reviewed_at: null, apply_result: { error: message } })
        .eq("id", auditId);
    }
    await logSystemHealth(admin, {
      function_name: "stage2-review", severity: "ERROR", error_message: message, stack_trace: e instanceof Error ? e.stack : null,
      household_id: householdId && UUID.test(householdId) ? householdId : null,
    });
    return json({ error: "Internal error", details: message }, 500);
  }
});
