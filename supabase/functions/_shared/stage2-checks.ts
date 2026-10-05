// stage2-checks.ts — Stage 2 of the two-stage document pipeline. Stage 1
// (the LLM) extracts figures; Stage 2 is deterministic code that re-checks
// them: plausibility, internal consistency, and completeness. Figures printed
// on an official statement (e.g. the gain) are taken as authoritative. Every check
// carries a plain-English reasoning string (Glass-Box), and a check that
// can't run because inputs are missing is "skipped" with the reason, never a
// silent pass. Pure: no LLM, no I/O.

export type CheckStatus = "pass" | "fail" | "skipped";
export interface CheckResult {
  id: string;
  status: CheckStatus;
  /** Where it applies, e.g. an account number or policy number. */
  subject?: string;
  reasoning: string;
}

export type OverallStatus = "VERIFIED" | "INCOMPLETE" | "CONFLICT";

export interface ExtractedAccount {
  account_name?: string | null;
  account_number?: string | null;
  book_value?: number | null;
  current_harvest?: number | null;
  current_value?: number | null;
}
export interface InvestmentExtraction {
  statement_date?: string | null;
  accounts?: ExtractedAccount[];
  missing_fields?: string[];
}

export interface ExtractedPolicy {
  policy_number?: string | null;
  coverage_amount?: number | null;
  premium_amount?: number | null;
  issue_date?: string | null;
  renewal_date?: string | null;
}
export interface InsuranceExtraction {
  policies?: ExtractedPolicy[];
  missing_fields?: string[];
}

const money = (n: number) => n.toLocaleString("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 2 });
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const label = (a: { account_name?: string | null; account_number?: string | null; policy_number?: string | null }) =>
  a.account_number ?? a.policy_number ?? a.account_name ?? "unlabelled";

/** Absolute tolerance: 50 cents or 0.5% of the value, whichever is larger (statements round). */
const tolerance = (basis: number) => Math.max(0.5, Math.abs(basis) * 0.005);
const MAX_STATEMENT_AGE_DAYS = 548; // ~18 months

export function checkInvestment(x: InvestmentExtraction, now: Date = new Date()): CheckResult[] {
  const out: CheckResult[] = [];
  const accounts = x.accounts ?? [];

  if (accounts.length === 0) {
    out.push({ id: "accounts_present", status: "fail", reasoning: "No accounts were extracted from this document." });
  }

  // Statement date plausibility
  if (!x.statement_date) {
    out.push({ id: "statement_date_plausible", status: "skipped", reasoning: "No statement date was extracted, so recency can't be checked." });
  } else {
    const d = new Date(x.statement_date + "T00:00:00Z");
    const ageDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
    if (Number.isNaN(d.getTime())) {
      out.push({ id: "statement_date_plausible", status: "fail", reasoning: `"${x.statement_date}" is not a valid date.` });
    } else if (ageDays < -1) {
      out.push({ id: "statement_date_plausible", status: "fail", reasoning: `Statement date ${x.statement_date} is in the future.` });
    } else if (ageDays > MAX_STATEMENT_AGE_DAYS) {
      out.push({ id: "statement_date_plausible", status: "fail", reasoning: `Statement date ${x.statement_date} is ${ageDays} days old (limit ${MAX_STATEMENT_AGE_DAYS}); too stale to rely on.` });
    } else {
      out.push({ id: "statement_date_plausible", status: "pass", reasoning: `Statement date ${x.statement_date} is ${Math.max(ageDays, 0)} days old, within the ${MAX_STATEMENT_AGE_DAYS}-day limit.` });
    }
  }

  const seen = new Map<string, number>();
  for (const a of accounts) {
    const subject = label(a);
    if (a.account_number) seen.set(a.account_number, (seen.get(a.account_number) ?? 0) + 1);

    if (!isNum(a.current_value)) {
      out.push({ id: "value_present", status: "fail", subject, reasoning: `No current value was extracted for ${subject}.` });
      continue;
    }
    if (a.current_value < 0) {
      out.push({ id: "value_non_negative", status: "fail", subject, reasoning: `Current value ${money(a.current_value)} is negative; accounts held here shouldn't be.` });
    }
    // The gain printed on an official statement is authoritative. It routinely
    // includes contributions, withdrawals and fees, so it is NOT expected to
    // equal current value minus book value; a mismatch is noted, never a
    // conflict. Only a missing gain is a gap.
    if (isNum(a.current_harvest)) {
      if (isNum(a.book_value)) {
        const expected = a.current_value - a.book_value;
        const diff = Math.abs(expected - a.current_harvest);
        const tol = tolerance(a.current_value);
        out.push({
          id: "harvest_arithmetic", status: "pass", subject,
          reasoning: diff <= tol
            ? `Current value ${money(a.current_value)} minus book value ${money(a.book_value)} is ${money(expected)}, matching the stated gain of ${money(a.current_harvest)} (tolerance ${money(tol)}).`
            : `Stated gain ${money(a.current_harvest)} accepted as printed on the statement. It differs from current value minus book value (${money(expected)}) by ${money(diff)}, which is normal when the period includes contributions, withdrawals or fees.`,
        });
      } else {
        out.push({ id: "harvest_arithmetic", status: "pass", subject, reasoning: `Stated gain ${money(a.current_harvest)} accepted as printed on the statement (no book value was extracted to compare it with).` });
      }
    } else {
      out.push({ id: "harvest_arithmetic", status: "skipped", subject, reasoning: `No gain was extracted for ${subject}, so there is nothing to confirm.` });
    }
  }

  for (const [num, count] of seen) {
    if (count > 1) out.push({ id: "duplicate_account_number", status: "fail", subject: num, reasoning: `Account number ${num} appears ${count} times in this document.` });
  }
  return out;
}

export function checkInsurance(x: InsuranceExtraction): CheckResult[] {
  const out: CheckResult[] = [];
  const policies = x.policies ?? [];
  if (policies.length === 0) {
    out.push({ id: "policies_present", status: "fail", reasoning: "No policies were extracted from this document." });
  }
  for (const p of policies) {
    const subject = label(p);
    if (!isNum(p.coverage_amount) || p.coverage_amount <= 0) {
      out.push({ id: "coverage_positive", status: "fail", subject, reasoning: `No positive coverage amount was extracted for policy ${subject}.` });
    } else {
      out.push({ id: "coverage_positive", status: "pass", subject, reasoning: `Coverage of ${money(p.coverage_amount)} is a positive amount.` });
    }
    if (p.issue_date && p.renewal_date) {
      const ok = p.renewal_date > p.issue_date; // ISO dates compare lexically
      out.push({ id: "renewal_after_issue", status: ok ? "pass" : "fail", subject,
        reasoning: ok ? `Renewal ${p.renewal_date} is after issue ${p.issue_date}.` : `Renewal ${p.renewal_date} is not after issue ${p.issue_date}.` });
    } else {
      out.push({ id: "renewal_after_issue", status: "skipped", subject, reasoning: `Issue or renewal date missing for policy ${subject}.` });
    }
  }
  return out;
}

export interface Stage2Verdict {
  overall_status: OverallStatus;
  advisor_override_required: boolean;
  missing_items: string[];
}

/**
 * CONFLICT: something extracted contradicts itself or is implausible.
 * INCOMPLETE: nothing contradicts, but required data is missing/uncheckable.
 * VERIFIED: every check ran and passed. Advisors review anything not VERIFIED.
 */
export function verdictFor(checks: CheckResult[], modelMissingFields: string[] = []): Stage2Verdict {
  const missing = [...modelMissingFields];
  for (const c of checks) if (c.status === "skipped") missing.push(c.subject ? `${c.id} (${c.subject})` : c.id);
  const anyFail = checks.some((c) => c.status === "fail");
  const overall: OverallStatus = anyFail ? "CONFLICT" : missing.length > 0 ? "INCOMPLETE" : "VERIFIED";
  return { overall_status: overall, advisor_override_required: overall !== "VERIFIED", missing_items: [...new Set(missing)] };
}
