// stage2-auto.ts: after a Vault scan, approve the items Stage 2 fully verified and leave only the exceptions for Rolf.
// An item is approved automatically only when it is VERIFIED, is an investment statement or an insurance document (estate documents
// are always reviewed by a person), and applying it would only update accounts or policies already on file: nothing new is created.

// deno-lint-ignore-file no-explicit-any
import { applyPlan, type PlannedWrite } from "./vault-apply.ts";
import { buildApprovalPlan } from "./stage2-apply.ts";
import { logActionEvent } from "./action-brain.ts";

export type AutoDecision = { ok: true } | { ok: false; reason: string };

export function autoApproveDecision(kind: string, overallStatus: string, missing: string[], plan: PlannedWrite[] | null): AutoDecision {
  if (kind === "estate") return { ok: false, reason: "Estate documents are always reviewed by a person." };
  if (overallStatus === "CONFLICT") return { ok: false, reason: "Verification found a conflict in the figures." };
  if (overallStatus !== "VERIFIED") return { ok: false, reason: `Not fully verified${missing.length ? `: ${missing.slice(0, 3).join(", ")}` : ""}.` };
  if (!plan || plan.length === 0) return { ok: false, reason: "Nothing on file matched this document." };
  const created = plan.filter((w) => w.op === "insert");
  if (created.length) return { ok: false, reason: `It would add ${created.length === 1 ? "a new record" : `${created.length} new records`} (${created.slice(0, 2).map((w) => (w as any).label).join(", ")}): confirm they are not duplicates.` };
  return { ok: true };
}

export interface AutoResult { approved: boolean; reason?: string }

/** Approves one pending audit row if it qualifies. Never throws: a failure leaves the row pending and is reported as an exception. */
export async function tryAutoApprove(admin: any, auditId: string): Promise<AutoResult> {
  const { data: audit } = await admin.from("stage2_verification_audit").select("*").eq("id", auditId).maybeSingle();
  if (!audit || audit.review_status !== "pending") return { approved: false, reason: "Already reviewed." };
  const kind = audit.extracted_entities?.kind;
  const extraction = audit.extracted_entities?.extraction ?? {};
  const listKey = kind === "investment" ? "accounts" : kind === "estate" ? "documents" : "policies";
  let claimed = false;
  try {
    const plan = kind === "estate" ? null : await buildApprovalPlan(admin, {
      kind, items: extraction[listKey] ?? [], statementDate: typeof extraction.statement_date === "string" ? extraction.statement_date : null,
      householdId: audit.household_id, source: audit.extracted_entities?.source ?? {}, auditId, approvedBy: null,
    });
    const decision = autoApproveDecision(kind, audit.overall_status, audit.missing_items ?? [], plan);
    if (!decision.ok) return { approved: false, reason: (decision as { reason: string }).reason };

    // Claim first so a second scan can't apply it twice.
    const now = new Date().toISOString();
    const { data: won } = await admin.from("stage2_verification_audit").update({ review_status: "approved", reviewed_by: null, reviewed_at: now }).eq("id", auditId).eq("review_status", "pending").select("id");
    if (!won?.length) return { approved: false, reason: "Already reviewed." };
    claimed = true;
    const result = await applyPlan(admin, plan!);
    await admin.from("stage2_verification_audit").update({ applied_at: new Date().toISOString(), apply_result: { ...result, auto_approved: true } }).eq("id", auditId);
    await logActionEvent(admin, {
      household_id: audit.household_id, actor_id: null, actor_role: "SYSTEM_AGENT", action_type: "stage2_auto_approve", workflow_module: "vault_statement_scan",
      input_context_snapshot: { kind, overall_status: audit.overall_status, checks: (audit.arithmetic_checks ?? []).map((c: any) => ({ id: c.id, status: c.status })) },
      human_final_payload: { decision: "auto_approved" }, metadata: { audit_id: auditId, updated: result.updated, inserted: result.inserted },
    });
    return { approved: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (claimed) await admin.from("stage2_verification_audit").update({ review_status: "pending", reviewed_by: null, reviewed_at: null, apply_result: { error: message } }).eq("id", auditId);
    return { approved: false, reason: `Could not apply: ${message}` };
  }
}
