// withdrawal-availability.ts — "how much can come out of this account this year?"
//
//   surplus   = current value - opening (BOY) value
//             = net gain + net transactions: the growth NOT yet withdrawn, so
//               taking it never touches principal.
//   income    = value held in the Income funds (the funds withdrawals are
//               drawn from). A surplus that sits in equity funds is on paper
//               only: drawing it would mean selling equities.
//   available = the lesser of the two (never below zero).
//
// The fund lines are extracted exactly as printed and summed HERE, never by the
// model. A funds list that doesn't add up to the statement value is an
// incomplete extraction (or holdings the table doesn't list), so the result is
// then flagged unconfirmed instead of presented as fact. Pure: no LLM, no I/O.
// Also imported by the review UI so the figures update live as an advisor corrects terms.

export interface FundLine {
  name?: string | null;
  /** The category heading printed above the fund, e.g. "Income Funds". */
  category?: string | null;
  /** Fund value as printed. */
  value?: number | null;
}

export interface AvailabilityInput {
  book_value?: number | null; // opening / BOY value
  current_value?: number | null;
  funds?: FundLine[] | null;
}

/** Which category headings count as Income funds. One place to change if other custodians label them differently. */
export const INCOME_CATEGORY = /\bincome\b/i;

export type AvailabilityStatus =
  | "confirmed"        // surplus and income funds known, and the funds list adds up to the statement value
  | "unconfirmed"      // funds were extracted but don't add up to the statement value
  | "insufficient";    // opening/current value missing, or no funds on the statement

export interface Availability {
  status: AvailabilityStatus;
  /** Growth not yet withdrawn (may be negative). Null if opening/current value is missing. */
  surplus: number | null;
  /** Total of the funds under an Income heading. Null if no funds were extracted. */
  income_funds: number | null;
  funds_total: number | null;
  /** current value - funds_total (what the listed funds don't explain). Null if not applicable. */
  funds_gap: number | null;
  /** The lesser of surplus and income funds, floored at 0. Null unless both are known. */
  available: number | null;
  limited_by: "income_funds" | "surplus" | "none" | null;
  funds: Array<{ name: string; category: string; value: number; is_income: boolean }>;
  notes: string[];
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const round2 = (n: number) => Math.round(n * 100) / 100;
/** Fund values must sum to the statement value to the cent; only rounding is tolerated ($1 or 0.02%). */
const sumTolerance = (basis: number) => Math.max(1, Math.abs(basis) * 0.0002);
const money = (n: number) => n.toLocaleString("en-CA", { style: "currency", currency: "CAD" });

export function computeAvailability(a: AvailabilityInput): Availability {
  const notes: string[] = [];
  const surplus = isNum(a.book_value) && isNum(a.current_value) ? round2(a.current_value - a.book_value) : null;
  if (surplus === null) notes.push("An opening balance and a current value are needed to work out the surplus.");

  const funds = (a.funds ?? [])
    .filter((f): f is FundLine & { value: number } => isNum(f?.value))
    .map((f) => ({
      name: (f.name ?? "").trim() || "Unnamed fund",
      category: (f.category ?? "").trim() || "Uncategorised",
      value: f.value,
      is_income: INCOME_CATEGORY.test(f.category ?? ""),
    }));

  if (funds.length === 0) {
    notes.push("No fund holdings were extracted, so the income funds balance is unknown.");
    return { status: "insufficient", surplus, income_funds: null, funds_total: null, funds_gap: null, available: null, limited_by: null, funds, notes };
  }

  const fundsTotal = round2(funds.reduce((s, f) => s + f.value, 0));
  const incomeFunds = round2(funds.filter((f) => f.is_income).reduce((s, f) => s + f.value, 0));
  if (!funds.some((f) => f.is_income)) notes.push('No fund was listed under an "Income" heading, so the income funds balance is $0.');

  let gap: number | null = null;
  let complete = false;
  if (isNum(a.current_value)) {
    gap = round2(a.current_value - fundsTotal);
    complete = Math.abs(gap) <= sumTolerance(a.current_value);
    if (!complete) notes.push(`The funds listed total ${money(fundsTotal)} but the statement value is ${money(a.current_value)} (${money(Math.abs(gap))} ${gap > 0 ? "not accounted for" : "over"}); the income funds balance may be incomplete.`);
  } else {
    notes.push("No current value to confirm the funds list against.");
  }

  let available: number | null = null;
  let limitedBy: Availability["limited_by"] = null;
  if (surplus !== null) {
    const cap = Math.max(0, surplus);
    available = round2(Math.max(0, Math.min(cap, incomeFunds)));
    limitedBy = surplus <= 0 ? "surplus" : incomeFunds < surplus ? "income_funds" : incomeFunds > surplus ? "surplus" : "none";
    if (surplus <= 0) notes.push("There is no surplus: any withdrawal would come out of principal.");
    else if (limitedBy === "income_funds") notes.push(`The surplus of ${money(surplus)} exceeds the income funds on hand (${money(incomeFunds)}); the rest is held in other funds.`);
  }

  const status: AvailabilityStatus = surplus !== null && complete ? "confirmed" : surplus === null ? "insufficient" : "unconfirmed";
  return { status, surplus, income_funds: incomeFunds, funds_total: fundsTotal, funds_gap: gap, available, limited_by: limitedBy, funds, notes };
}
