// Shapes and field list for the household Tax page; the tax itself is worked out by the household-tax function.

export const LINE_KEYS = [
  "employment", "pension_registered", "government_benefits", "interest_other", "eligible_dividends", "other_dividends",
  "capital_gains", "other_income", "deductions", "credit_amounts",
] as const;
export type LineKey = (typeof LINE_KEYS)[number];
export type Lines = Record<LineKey, number>;
export type Sources = Partial<Record<LineKey, "return" | "detected" | "manual" | "baseline">>;

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

export interface Computed {
  totalIncome: number; taxableIncome: number; dividendsGrossedUp: number; taxableGains: number; dividendCredit: number;
  federalTax: number; provincialTax: number; totalTax: number; marginalRate: number; effectiveRate: number; afterTax: number;
}

export interface TaxColumn {
  saved: boolean; lines: Lines; sources: Sources; computed: Computed | null; sourceFile: string | null;
  reported?: { total_income: number; taxable_income: number; total_tax_payable: number } | null;
  suggested?: Lines;
}
export interface TaxPerson { contactId: string; name: string; hasAccounts: boolean; baseline: TaxColumn; projection: TaxColumn }
export interface TaxData {
  year: number; baselineYear: number; province: string; provinces: Record<string, string>; tableYear: number; slipMixYear: number | null; people: TaxPerson[];
}

/** A line edited by hand is marked manual so a re-read of the return or slips never overwrites it. */
export function withEdit(lines: Lines, sources: Sources, key: LineKey, value: number): { lines: Lines; sources: Sources } {
  return { lines: { ...lines, [key]: Math.max(0, Number.isFinite(value) ? value : 0) }, sources: { ...sources, [key]: "manual" } };
}

export const change = (base: number, proj: number) => proj - base;
