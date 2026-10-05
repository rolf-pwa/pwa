// stage2-checks.ts — Stage 2 of the two-stage document pipeline. Stage 1
// (the LLM) extracts figures; Stage 2 is deterministic code that re-checks
// them: plausibility, internal consistency, and completeness. Figures printed
// on an official statement (e.g. the net gain) are taken as authoritative. Every check
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
  /** Withdrawals / redemptions for the period, as printed (positive). */
  withdrawals?: number | null;
  /** Contributions / deposits / transfers in for the period, as printed (positive). */
  contributions?: number | null;
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

/** Reconciliation is an exact identity on the statement, so only rounding is tolerated: $1 or 0.02% of the value. */
const reconcileTolerance = (basis: number) => Math.max(1, Math.abs(basis) * 0.0002);
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
    // Net gain reconciliation. A statement reconciles as
    //   BOY value - withdrawals (+ contributions) + net gain = current value.
    // The net gain is taken as printed (it is NOT "current - book": withdrawals
    // reduce the balance without touching principal). The identity can only be
    // checked when the statement's other terms were extracted, so without them
    // this never fails -- it notes what the figures imply instead.
    if (isNum(a.current_harvest)) {
      const gain = a.current_harvest;
      if (isNum(a.book_value)) {
        const tol = reconcileTolerance(a.current_value);
        const hasWithdrawals = isNum(a.withdrawals);
        const hasContributions = isNum(a.contributions);
        if (hasWithdrawals || hasContributions) {
          const w = hasWithdrawals ? (a.withdrawals as number) : 0;
          const c = hasContributions ? (a.contributions as number) : 0;
          const expected = a.book_value + c - w + gain;
          const diff = Math.abs(expected - a.current_value);
          const terms = `BOY value ${money(a.book_value)}${hasContributions ? ` + contributions ${money(c)}` : ""}${hasWithdrawals ? ` - withdrawals ${money(w)}` : ""} + net gain ${money(gain)} = ${money(expected)}`;
          out.push(diff <= tol
            ? { id: "net_gain_reconciliation", status: "pass", subject, reasoning: `${terms}, matching the statement's current value of ${money(a.current_value)}.` }
            : { id: "net_gain_reconciliation", status: "fail", subject, reasoning: `${terms}, but the statement's current value is ${money(a.current_value)} (off by ${money(diff)}, tolerance ${money(tol)}). Check the withdrawals, contributions and net gain against the statement.` });
        } else {
          const implied = a.book_value + gain - a.current_value; // withdrawals needed to reconcile
          const note = Math.abs(implied) <= tol
            ? `BOY value ${money(a.book_value)} + net gain ${money(gain)} equals the current value of ${money(a.current_value)}: no withdrawals needed.`
            : implied > 0
              ? `Net gain ${money(gain)} accepted as printed. BOY value ${money(a.book_value)} + net gain only reaches the current value ${money(a.current_value)} if withdrawals of ${money(implied)} were made; no withdrawals were extracted to confirm.`
              : `Net gain ${money(gain)} accepted as printed. The current value ${money(a.current_value)} is ${money(-implied)} above BOY value + net gain, which implies contributions or transfers in; none were extracted to confirm.`;
          out.push({ id: "net_gain_reconciliation", status: "pass", subject, reasoning: note });
        }
      } else {
        out.push({ id: "net_gain_reconciliation", status: "pass", subject, reasoning: `Net gain ${money(gain)} accepted as printed (no BOY value was extracted to reconcile it with).` });
      }
    } else {
      out.push({ id: "net_gain_reconciliation", status: "skipped", subject, reasoning: `No net gain was extracted for ${subject}, so there is nothing to confirm.` });
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
