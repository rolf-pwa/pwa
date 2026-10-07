// How a household's investment income was made up last year, from its T3 / T5 slips: the share that was interest and
// other income, eligible and other dividends, capital gains and return of capital. Used to split this year's
// withdrawals from non-registered accounts for the income tax projection. Pure: no I/O.

export interface SlipExtract {
  slip_type: string;           // T3 | T5 | RL-3 | RL-16 | other
  tax_year: number | null;
  recipient: string | null;
  interest_and_other_income: number;
  eligible_dividends: number;  // actual amount, before gross-up
  other_dividends: number;     // actual amount, before gross-up
  capital_gains: number;       // actual gain, before the inclusion rate
  return_of_capital: number;
}

export interface IncomeMix {
  taxYear: number;
  slipCount: number;
  total: number;
  shares: { interest: number; eligibleDividends: number; otherDividends: number; capitalGains: number; returnOfCapital: number };
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);
const SLIP_TYPES = new Set(["T3", "T5", "RL-3", "RL-16"]);

export function sanitizeSlips(raw: unknown): SlipExtract[] {
  if (!Array.isArray(raw)) return [];
  const out: SlipExtract[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const type = String(o.slip_type ?? "").trim().toUpperCase();
    out.push({
      slip_type: SLIP_TYPES.has(type) ? type : "other",
      tax_year: typeof o.tax_year === "number" && o.tax_year > 2000 && o.tax_year < 2100 ? Math.trunc(o.tax_year) : null,
      recipient: o.recipient ? String(o.recipient).slice(0, 120) : null,
      interest_and_other_income: num(o.interest_and_other_income), eligible_dividends: num(o.eligible_dividends),
      other_dividends: num(o.other_dividends), capital_gains: num(o.capital_gains), return_of_capital: num(o.return_of_capital),
    });
    if (out.length >= 40) break;
  }
  return out;
}

/** The mix across every income slip for the given tax year; null when there are none or they add to nothing. */
export function mixFromSlips(slips: SlipExtract[], taxYear: number): IncomeMix | null {
  const mine = slips.filter((s) => s.slip_type !== "other" && s.tax_year === taxYear);
  const sum = (f: (s: SlipExtract) => number) => mine.reduce((a, s) => a + f(s), 0);
  const interest = sum((s) => s.interest_and_other_income), eligible = sum((s) => s.eligible_dividends), other = sum((s) => s.other_dividends);
  const gains = sum((s) => s.capital_gains), roc = sum((s) => s.return_of_capital);
  const total = interest + eligible + other + gains + roc;
  if (mine.length === 0 || total <= 0) return null;
  return {
    taxYear, slipCount: mine.length, total,
    shares: { interest: interest / total, eligibleDividends: eligible / total, otherDividends: other / total, capitalGains: gains / total, returnOfCapital: roc / total },
  };
}
