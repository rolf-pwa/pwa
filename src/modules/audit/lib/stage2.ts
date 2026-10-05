// Types and pure helpers for the Glass-Box Stage 2 review UI. The shapes
// mirror what stage2-run.ts stores in stage2_verification_audit (JSONB).

export type CheckStatus = "pass" | "fail" | "skipped";
export interface Stage2Check { id: string; status: CheckStatus; subject?: string; reasoning: string }

/** [ymin, xmin, ymax, xmax], integers normalised to 0-1000 of the page. */
export type BoundingBox = [number, number, number, number];
export interface SourceRef { page_number: number | null; bounding_box: BoundingBox | null; quote: string | null }

export interface ReviewItem extends Record<string, unknown> { source?: SourceRef | null }

export interface ReasoningStep { node: string; label: string; value: number; because: string; intervened?: boolean }
export interface InterventionResult {
  intervention_id: string; label: string;
  effects: Array<{ risk: string; label: string; before: number; after: number; delta: number }>;
}
export interface CausalEvaluation {
  assessment_id: string | null;
  note?: string;
  model?: string;
  risks?: Record<string, number | null>;
  reasoning_steps?: ReasoningStep[];
  interventions?: InterventionResult[];
  rule_flags?: Array<{ rule_id: string; risk_name: string; severity: string; action: string }>;
}

export interface Stage2AuditRow {
  id: string;
  created_at: string;
  household_id: string;
  overall_status: "VERIFIED" | "INCOMPLETE" | "CONFLICT";
  review_status: "pending" | "approved" | "rejected";
  advisor_override_required: boolean;
  extracted_entities: {
    kind: "investment" | "insurance";
    source: { drive_id?: string; file_name?: string } | null;
    extraction: Record<string, unknown> & { accounts?: ReviewItem[]; policies?: ReviewItem[]; statement_date?: string | null };
  };
  arithmetic_checks: Stage2Check[];
  causal_dag_evaluations: CausalEvaluation;
  missing_items: string[] | null;
  applied_at: string | null;
  households?: { label: string | null } | null;
}

export const itemsOf = (row: Stage2AuditRow): ReviewItem[] =>
  (row.extracted_entities.kind === "investment" ? row.extracted_entities.extraction.accounts : row.extracted_entities.extraction.policies) ?? [];

/** Fields an advisor can correct, with labels; mirrors vault-apply.ts's allow-lists. */
export const EDITABLE_FIELDS: Record<"investment" | "insurance", Array<{ key: string; label: string; numeric: boolean }>> = {
  investment: [
    { key: "account_name", label: "Account", numeric: false },
    { key: "account_number", label: "Number", numeric: false },
    { key: "book_value", label: "BOY value", numeric: true },
    { key: "net_transactions", label: "Net transactions", numeric: true },
    { key: "current_harvest", label: "Net gain", numeric: true },
    { key: "current_value", label: "Current value", numeric: true },
  ],
  insurance: [
    { key: "carrier", label: "Carrier", numeric: false },
    { key: "policy_number", label: "Policy #", numeric: false },
    { key: "insured_name", label: "Insured", numeric: false },
    { key: "coverage_amount", label: "Coverage", numeric: true },
    { key: "premium_amount", label: "Premium", numeric: true },
  ],
};

/** Highlight rectangle as CSS percentages of the rendered page. */
export function boxToPercent(box: BoundingBox) {
  const [ymin, xmin, ymax, xmax] = box;
  return { top: ymin / 10, left: xmin / 10, height: (ymax - ymin) / 10, width: (xmax - xmin) / 10 };
}

export function riskLevel(score: number): { label: "Low" | "Moderate" | "High" | "Critical"; tone: string } {
  if (score >= 75) return { label: "Critical", tone: "bg-red-500" };
  if (score >= 50) return { label: "High", tone: "bg-orange-500" };
  if (score >= 25) return { label: "Moderate", tone: "bg-amber-400" };
  return { label: "Low", tone: "bg-emerald-500" };
}

/** Index of the item a check is about (matched on the account/policy label), or null for document-level checks. */
export function itemIndexForCheck(row: Stage2AuditRow, check: Stage2Check): number | null {
  if (!check.subject) return null;
  const items = itemsOf(row);
  const idx = items.findIndex((i) =>
    [i.account_number, i.policy_number, i.account_name, i.carrier].some((v) => typeof v === "string" && v === check.subject));
  return idx === -1 ? null : idx;
}

export function summarizeChecks(checks: Stage2Check[]) {
  return {
    pass: checks.filter((c) => c.status === "pass").length,
    fail: checks.filter((c) => c.status === "fail").length,
    skipped: checks.filter((c) => c.status === "skipped").length,
  };
}

export interface Correction { index: number; field: string; value: string | number | null; notes?: string }

/** Parses what the advisor typed for a field; undefined when it's not a valid number for a numeric field. */
export function parseFieldInput(raw: string, numeric: boolean): string | number | null | undefined {
  const t = raw.trim();
  if (t === "") return null;
  if (!numeric) return t;
  const n = Number(t.replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : undefined;
}
