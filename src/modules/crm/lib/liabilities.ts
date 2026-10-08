// Pure helpers for the household Liabilities tab. A "limit" means a credit limit for revolving credit
// (HELOC, credit card, line of credit) and the original amount for term debt (mortgage, personal loan).

export type LiabilityType = "mortgage" | "heloc" | "credit_card" | "personal_loan" | "line_of_credit" | "other_debt";

export const REVOLVING_TYPES: ReadonlySet<string> = new Set(["heloc", "credit_card", "line_of_credit"]);

export interface LiabilityLike {
  liability_type: string;
  current_balance: number | null;
  credit_limit?: number | null;
  original_amount?: number | null;
  interest_rate_pct?: number | null;
}

export const isRevolving = (type: string) => REVOLVING_TYPES.has(type);

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** The limit shown for a row: credit limit for revolving credit, original amount for term debt. */
export function limitOf(l: LiabilityLike): number | null {
  return isRevolving(l.liability_type) ? num(l.credit_limit) : num(l.original_amount);
}

/** Credit still available on revolving credit (never below zero); null for term debt or when no limit is set. */
export function creditAvailable(l: LiabilityLike): number | null {
  if (!isRevolving(l.liability_type)) return null;
  const limit = num(l.credit_limit);
  if (limit === null) return null;
  return Math.max(0, Math.round((limit - (num(l.current_balance) ?? 0)) * 100) / 100);
}

export interface LiabilityTotals { balance: number; revolvingLimit: number; creditAvailable: number }

export function liabilityTotals(rows: LiabilityLike[]): LiabilityTotals {
  let balance = 0, revolvingLimit = 0, available = 0;
  for (const r of rows) {
    balance += num(r.current_balance) ?? 0;
    const a = creditAvailable(r);
    if (a !== null) { revolvingLimit += num(r.credit_limit) ?? 0; available += a; }
  }
  const round = (n: number) => Math.round(n * 100) / 100;
  return { balance: round(balance), revolvingLimit: round(revolvingLimit), creditAvailable: round(available) };
}

export const CATEGORIES: { key: string; title: string; types: LiabilityType[]; limitLabel: string }[] = [
  { key: "mortgage", title: "Mortgages", types: ["mortgage"], limitLabel: "Original amount" },
  { key: "heloc", title: "HELOCs", types: ["heloc"], limitLabel: "Limit" },
  { key: "credit_card", title: "Credit Cards", types: ["credit_card"], limitLabel: "Limit" },
  { key: "personal_loan", title: "Personal Loans", types: ["personal_loan"], limitLabel: "Original amount" },
  { key: "other", title: "Other", types: ["line_of_credit", "other_debt"], limitLabel: "Limit" },
];

export const TYPE_LABELS: Record<LiabilityType, string> = {
  mortgage: "Mortgage", heloc: "HELOC", credit_card: "Credit Card", personal_loan: "Personal Loan",
  line_of_credit: "Line of Credit", other_debt: "Other Debt",
};

/** Estimated yearly interest on one liability: balance x rate. null when no rate is recorded. */
export function annualInterest(l: LiabilityLike): number | null {
  const rate = num(l.interest_rate_pct);
  if (rate === null) return null;
  return Math.round(((num(l.current_balance) ?? 0) * rate) / 100);
}

export interface InterestTotals { interest: number; ratedCount: number; unratedCount: number; unratedBalance: number }

/** Yearly interest on the liabilities that have a rate, and how many (and how much debt) have none and so can't be costed. Debts with no balance are ignored. */
export function interestTotals(rows: LiabilityLike[]): InterestTotals {
  let interest = 0, ratedCount = 0, unratedCount = 0, unratedBalance = 0;
  for (const r of rows) {
    const bal = num(r.current_balance) ?? 0;
    if (bal <= 0) continue;
    const i = annualInterest(r);
    if (i === null) { unratedCount += 1; unratedBalance += bal; } else { interest += i; ratedCount += 1; }
  }
  return { interest, ratedCount, unratedCount, unratedBalance: Math.round(unratedBalance * 100) / 100 };
}

/** Share of a credit limit in use, 0-100; null for term debt or with no limit. */
export function utilisationPct(l: LiabilityLike): number | null {
  if (!isRevolving(l.liability_type)) return null;
  const limit = num(l.credit_limit);
  if (limit === null || limit <= 0) return null;
  return Math.min(100, Math.max(0, Math.round(((num(l.current_balance) ?? 0) / limit) * 100)));
}
