// withdrawal-availability.ts — "how much can come out of this account this year?"
//
//   surplus   = current value - opening (BOY) value
//             = net gain + net transactions: the growth NOT yet withdrawn, so
//               taking it never touches principal.
//   income    = value held in income-type holdings (income / fixed-income funds,
//               money market, cash, HISA): what withdrawals are drawn from. A surplus that sits in equity funds is on paper
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

/**
 * What counts as "income" money, i.e. what withdrawals are drawn from: income / fixed-income
 * funds, money market, cash and high-interest savings (HISA). Matched on the category heading
 * printed above the fund (or on the fund's name when no heading was printed). One place to
 * change if other custodians label things differently. GICs and equity/balanced funds do not count.
 */
export const INCOME_CATEGORY = /\b(income|money[\s-]?market|cash|hisa|high[\s-]?interest[\s-]?savings?)\b/i;

/** Income test for one fund line: its category heading, or its name when it has no heading. */
export function isIncomeFund(f: { name?: string | null; category?: string | null }): boolean {
  const category = (f.category ?? "").trim();
  return INCOME_CATEGORY.test(category || (f.name ?? ""));
}

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

export interface WithdrawalFigures {
  /** current value - opening value (may be negative); null if either is missing. */
  surplus: number | null;
  /** The lesser of surplus and income funds, floored at 0; null unless both are known. */
  available: number | null;
  limited_by: "income_funds" | "surplus" | "none" | null;
}

/**
 * The core rule, shared by the statement review and the account cards (which only have the three
 * stored numbers, not the fund lines): available = max(0, min(surplus, income funds on hand)).
 */
export function availableForWithdrawal(a: { book_value?: number | null; current_value?: number | null; income_funds_value?: number | null }): WithdrawalFigures {
  const surplus = isNum(a.book_value) && isNum(a.current_value) ? round2(a.current_value - a.book_value) : null;
  if (surplus === null || !isNum(a.income_funds_value)) return { surplus, available: null, limited_by: null };
  const income = a.income_funds_value;
  const available = round2(Math.max(0, Math.min(Math.max(0, surplus), income)));
  const limited_by = surplus <= 0 ? "surplus" : income < surplus ? "income_funds" : income > surplus ? "surplus" : "none";
  return { surplus, available, limited_by };
}

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
      is_income: isIncomeFund(f),
    }));

  if (funds.length === 0) {
    notes.push("No fund holdings were extracted, so the income funds balance is unknown.");
    return { status: "insufficient", surplus, income_funds: null, funds_total: null, funds_gap: null, available: null, limited_by: null, funds, notes };
  }

  const fundsTotal = round2(funds.reduce((s, f) => s + f.value, 0));
  const incomeFunds = round2(funds.filter((f) => f.is_income).reduce((s, f) => s + f.value, 0));
  if (!funds.some((f) => f.is_income)) notes.push("Nothing was listed as income, money market, cash or HISA, so the income funds balance is $0.");

  let gap: number | null = null;
  let complete = false;
  if (isNum(a.current_value)) {
    gap = round2(a.current_value - fundsTotal);
    complete = Math.abs(gap) <= sumTolerance(a.current_value);
    if (!complete) notes.push(`The funds listed total ${money(fundsTotal)} but the statement value is ${money(a.current_value)} (${money(Math.abs(gap))} ${gap > 0 ? "not accounted for" : "over"}); the income funds balance may be incomplete.`);
  } else {
    notes.push("No current value to confirm the funds list against.");
  }

  const { available, limited_by: limitedBy } = availableForWithdrawal({ book_value: a.book_value, current_value: a.current_value, income_funds_value: incomeFunds });
  if (surplus !== null) {
    if (surplus <= 0) notes.push("There is no surplus: any withdrawal would come out of principal.");
    else if (limitedBy === "income_funds") notes.push(`The surplus of ${money(surplus)} exceeds the income funds on hand (${money(incomeFunds)}); the rest is held in other funds.`);
  }

  const status: AvailabilityStatus = surplus !== null && complete ? "confirmed" : surplus === null ? "insufficient" : "unconfirmed";
  return { status, surplus, income_funds: incomeFunds, funds_total: fundsTotal, funds_gap: gap, available, limited_by: limitedBy, funds, notes };
}
