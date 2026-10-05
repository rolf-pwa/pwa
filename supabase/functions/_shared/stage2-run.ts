// stage2-run.ts — runs Stage 2 for one extraction and records it in
// stage2_verification_audit. Shared by the stage2-verify function and by
// vault-statement-scan's V2 path. Never touches live account/policy rows.

// deno-lint-ignore-file no-explicit-any
/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  checkInsurance, checkInvestment, verdictFor,
  type CheckResult, type InsuranceExtraction, type InvestmentExtraction, type Stage2Verdict,
} from "./stage2-checks.ts";
import { compareInterventions, evaluate } from "./causal-dag-engine.ts";
import { CAUSAL_MODEL_V2, evidenceFromOntology, V2_INTERVENTIONS } from "./causal-model-v2.ts";
import { evaluateCausalDag, type OntologyAssessmentPayload } from "./causal-dag-evaluator.ts";
import { withSanitizedSources } from "./provenance.ts";

export interface Stage2Input {
  householdId: string;
  kind: "investment" | "insurance";
  extraction: Record<string, any>;
  /** vault_shoebox_proposals id, when the file came from the Shoebox. */
  documentId?: string | null;
  /** Where the file came from, kept with the entities for the review UI. */
  source?: { drive_id?: string; file_name?: string };
}

export interface Stage2Output extends Stage2Verdict {
  audit_id: string;
  checks: CheckResult[];
  causal: Record<string, unknown>;
}

async function causalFor(admin: any, householdId: string): Promise<Record<string, unknown>> {
  const { data: assessment } = await admin
    .from("household_ontology_assessments")
    .select("id, financial_state, relational_state, emotional_state, event_spoke_type, event_spoke_data")
    .eq("household_id", householdId)
    .order("assessment_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1).maybeSingle();
  if (!assessment) return { assessment_id: null, note: "No ontology assessment on file; causal model not evaluated." };

  const evidence = evidenceFromOntology(assessment as OntologyAssessmentPayload);
  const base = evaluate(CAUSAL_MODEL_V2, evidence);
  const risks: Record<string, number | null> = {};
  for (const n of CAUSAL_MODEL_V2.nodes.filter((n) => n.isRisk)) {
    const v = base.values[n.id];
    risks[n.id] = v === undefined ? null : Math.round(v * 100);
  }
  return {
    assessment_id: assessment.id,
    model: "causal-model-v2 (provisional weights)",
    risks,
    reasoning_steps: base.steps,
    interventions: compareInterventions(CAUSAL_MODEL_V2, evidence, V2_INTERVENTIONS),
    rule_flags: evaluateCausalDag(assessment as OntologyAssessmentPayload),
  };
}

export async function runStage2(admin: any, input: Stage2Input): Promise<Stage2Output> {
  const { householdId, kind, extraction } = input;

  // Provenance is validated here so nothing downstream trusts raw model output.
  const items = kind === "investment" ? "accounts" : "policies";
  const cleaned = { ...extraction, [items]: withSanitizedSources(extraction[items]) };

  const checks = kind === "investment"
    ? checkInvestment(cleaned as InvestmentExtraction)
    : checkInsurance(cleaned as InsuranceExtraction);
  const modelMissing = Array.isArray(extraction.missing_fields)
    ? extraction.missing_fields.filter((f: unknown): f is string => typeof f === "string")
    : [];
  const verdict = verdictFor(checks, modelMissing);
  const causal = await causalFor(admin, householdId);

  const { data: row, error } = await admin
    .from("stage2_verification_audit")
    .insert({
      household_id: householdId,
      document_id: input.documentId ?? null,
      overall_status: verdict.overall_status,
      extracted_entities: { kind, source: input.source ?? null, extraction: cleaned },
      arithmetic_checks: checks,
      causal_dag_evaluations: causal,
      missing_items: verdict.missing_items,
      advisor_override_required: verdict.advisor_override_required,
    })
    .select("id")
    .single();
  if (error || !row) throw new Error(error?.message ?? "Failed to write stage2 audit row");
  return { audit_id: row.id, ...verdict, checks, causal };
}
