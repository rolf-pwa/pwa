// The income-tax model behind the household Tax page and the Governance Audit: a set of income lines per taxpayer and
// year, and the tax worked out from them with the maintained tables (governance-audit-tax-config.ts). Pure: no I/O.
// Lines are stored in ACTUAL terms (dividends before gross-up, capital gains before the inclusion rate), the way a
// statement or slip prints them; the gross-up, inclusion rate and credits are applied here.

import { TAX_TABLES, type TaxBracket } from "./governance-audit-tax-config.ts";

export const LINE_KEYS = [
  "employment", "pension_registered", "government_benefits", "interest_other", "eligible_dividends", "other_dividends",
  "capital_gains", "other_income", "deductions", "credit_amounts",
] as const;
export type LineKey = typeof LINE_KEYS[number];
export type TaxLines = Record<LineKey, number>;
export type LineSource = "return" | "detected" | "manual" | "baseline";
export type LineSources = Partial<Record<LineKey, LineSource>>;

export const LINE_LABELS: Record<LineKey, string> = {
  employment: "Employment and self-employment income",
  pension_registered: "RRSP / RRIF / pension income",
  government_benefits: "Government benefits (CPP, OAS)",
  interest_other: "Interest and other investment income",
  eligible_dividends: "Eligible dividends (actual amount)",
  other_dividends: "Other dividends (actual amount)",
  capital_gains: "Capital gains (full gain)",
  other_income: "Other income",
  deductions: "Deductions (RRSP, carrying charges, etc.)",
  credit_amounts: "Other non-refundable credit amounts (age, pension, etc.)",
};

export const emptyLines = (): TaxLines => Object.fromEntries(LINE_KEYS.map((k) => [k, 0])) as TaxLines;

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** Validates stored or submitted lines: unknown keys dropped, non-numbers become 0, negatives only where meaningful (none). */
export function sanitizeLines(raw: unknown): TaxLines {
  const out = emptyLines();
  if (raw && typeof raw === "object") for (const k of LINE_KEYS) out[k] = Math.max(0, round2(num((raw as Record<string, unknown>)[k])));
  return out;
}

export function sanitizeSources(raw: unknown): LineSources {
  const out: LineSources = {};
  if (raw && typeof raw === "object") for (const k of LINE_KEYS) {
    const v = (raw as Record<string, unknown>)[k];
    if (v === "return" || v === "detected" || v === "manual" || v === "baseline") out[k] = v;
  }
  return out;
}

function progressive(income: number, brackets: TaxBracket[], credit: number): { tax: number; marginal: number } {
  let tax = 0, lower = 0, marginal = brackets[0]?.rate ?? 0;
  for (const b of brackets) {
    const upper = b.upTo ?? Infinity;
    if (income > lower) { tax += (Math.min(income, upper) - lower) * b.rate; marginal = b.rate; }
    lower = upper;
    if (income <= upper) break;
  }
  tax -= Math.min(income, credit) * brackets[0].rate; // non-refundable amounts, claimed at the lowest rate
  return { tax: Math.max(0, tax), marginal };
}

export interface TaxResult {
  totalIncome: number;        // as it would print on the return (dividends grossed up, gains at the inclusion rate)
  taxableIncome: number;
  dividendsGrossedUp: number;
  taxableGains: number;
  dividendCredit: number;
  federalTax: number;
  provincialTax: number;
  totalTax: number;
  marginalRate: number;
  effectiveRate: number;      // of total income
  afterTax: number;           // total income less tax (cash terms: actual dividends and the full gain count)
}

/** null when the province has no table. */
export function taxFromLines(province: string, lines: TaxLines): TaxResult | null {
  const prov = TAX_TABLES.provinces[province];
  if (!prov) return null;
  const gu = TAX_TABLES.dividendGrossUp;
  const eligibleGross = lines.eligible_dividends * (1 + gu.eligible), otherGross = lines.other_dividends * (1 + gu.other);
  const dividendsGrossedUp = eligibleGross + otherGross;
  const taxableGains = lines.capital_gains * TAX_TABLES.capitalGainsInclusionRate;
  const totalIncome = lines.employment + lines.pension_registered + lines.government_benefits + lines.interest_other + lines.other_income + dividendsGrossedUp + taxableGains;
  const taxableIncome = Math.max(0, totalIncome - lines.deductions);
  const credit = (c?: { eligible: number; other: number }) => (c ? eligibleGross * c.eligible + otherGross * c.other : 0);
  const fed = progressive(taxableIncome, TAX_TABLES.federal.brackets, (TAX_TABLES.federal.basicPersonalAmount ?? 0) + lines.credit_amounts);
  const pro = progressive(taxableIncome, prov.brackets, (prov.basicPersonalAmount ?? 0) + lines.credit_amounts);
  const federalTax = Math.max(0, fed.tax - credit(TAX_TABLES.federal.dividendCredits));
  const provincialTax = Math.max(0, pro.tax - credit(prov.dividendCredits));
  const totalTax = federalTax + provincialTax;
  const cash = lines.employment + lines.pension_registered + lines.government_benefits + lines.interest_other + lines.other_income + lines.eligible_dividends + lines.other_dividends + lines.capital_gains;
  return {
    totalIncome: round2(totalIncome), taxableIncome: round2(taxableIncome), dividendsGrossedUp: round2(dividendsGrossedUp), taxableGains: round2(taxableGains),
    dividendCredit: round2(credit(TAX_TABLES.federal.dividendCredits) + credit(prov.dividendCredits)),
    federalTax: round2(federalTax), provincialTax: round2(provincialTax), totalTax: round2(totalTax),
    marginalRate: fed.marginal + pro.marginal, effectiveRate: totalIncome > 0 ? totalTax / totalIncome : 0, afterTax: round2(cash - totalTax),
  };
}

/** What a filed T1 (or Notice of Assessment) printed, as read from the PDF: values exactly as shown, 0/absent when blank. */
export interface ReturnExtract {
  recipient: string | null;
  tax_year: number | null;
  employment_income: number;            // lines 10100 + 10400 + 13500 etc.
  pension_income: number;               // RRSP/RRIF/annuity/pension: lines 11500, 11600, 12900
  cpp_oas_income: number;               // lines 11400 + 11300
  interest_investment_income: number;   // line 12100 (+ other investment income 12100/12200)
  dividends_taxable_total: number;      // line 12000: taxable amount of dividends
  dividends_taxable_other: number;      // line 12010: taxable amount of dividends OTHER than eligible
  taxable_capital_gains: number;        // line 12700
  other_income: number;                 // line 13000 and the rest
  deductions_total: number;             // lines 20800 (RRSP) + other deductions before net income
  total_income: number;                 // line 15000
  taxable_income: number;               // line 26000
  total_tax_payable: number;            // line 43500
}

export const RETURN_FIELDS: (keyof ReturnExtract)[] = [
  "employment_income", "pension_income", "cpp_oas_income", "interest_investment_income", "dividends_taxable_total",
  "dividends_taxable_other", "taxable_capital_gains", "other_income", "deductions_total", "total_income", "taxable_income", "total_tax_payable",
];

export function sanitizeReturn(raw: unknown): ReturnExtract | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const r = { recipient: o.recipient ? String(o.recipient).slice(0, 120) : null, tax_year: typeof o.tax_year === "number" && o.tax_year > 2000 && o.tax_year < 2100 ? Math.trunc(o.tax_year) : null } as ReturnExtract;
  for (const f of RETURN_FIELDS) (r as unknown as Record<string, number>)[f] = Math.max(0, round2(num(o[f])));
  return r;
}

/** The return's printed lines expressed in the page's actual-amount terms (dividends back out of the gross-up, gains back out of the inclusion rate). */
export function linesFromReturn(r: ReturnExtract): TaxLines {
  const gu = TAX_TABLES.dividendGrossUp;
  const eligibleTaxable = Math.max(0, r.dividends_taxable_total - r.dividends_taxable_other);
  return sanitizeLines({
    employment: r.employment_income, pension_registered: r.pension_income, government_benefits: r.cpp_oas_income,
    interest_other: r.interest_investment_income, eligible_dividends: eligibleTaxable / (1 + gu.eligible),
    other_dividends: r.dividends_taxable_other / (1 + gu.other), capital_gains: r.taxable_capital_gains / TAX_TABLES.capitalGainsInclusionRate,
    other_income: r.other_income, deductions: r.deductions_total, credit_amounts: 0,
  });
}
