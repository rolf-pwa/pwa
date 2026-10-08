// Shapes and field list for the household Tax page; the tax itself is worked out by the household-tax function.

export const LINE_KEYS = [
  "employment", "pension_registered", "government_benefits", "interest_other", "eligible_dividends", "other_dividends",
  "capital_gains", "rental_income", "other_income", "deductions", "credit_amounts",
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
  rental_income: "Net rental income (after expenses; a loss is negative)",
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
export interface TaxPerson { contactId: string; name: string; province: string; hasAccounts: boolean; baseline: TaxColumn; projection: TaxColumn }
export interface TaxData {
  year: number; baselineYear: number; provinces: Record<string, string>; tableYear: number; slipMixYear: number | null; people: TaxPerson[];
}

/** A line edited by hand is marked manual so a re-read of the return or slips never overwrites it. */
export function withEdit(lines: Lines, sources: Sources, key: LineKey, value: number): { lines: Lines; sources: Sources } {
  return { lines: { ...lines, [key]: key === "rental_income" ? (Number.isFinite(value) ? value : 0) : Math.max(0, Number.isFinite(value) ? value : 0) }, sources: { ...sources, [key]: "manual" } };
}

export const change = (base: number, proj: number) => proj - base;

const SUM_KEYS: (keyof Computed)[] = ["totalIncome", "taxableIncome", "federalTax", "provincialTax", "totalTax", "afterTax"];

/** The household's total for one column: each person's computed figures added up (two separate returns, no splitting). People with no figures are left out and counted. */
export function householdTotals(people: TaxPerson[], kind: "baseline" | "projection"): { totals: Computed | null; counted: number; missing: string[] } {
  const have = people.filter((p) => p[kind].computed && p[kind].computed!.totalIncome > 0);
  const missing = people.filter((p) => !p[kind].computed || p[kind].computed!.totalIncome <= 0).map((p) => p.name);
  if (!have.length) return { totals: null, counted: 0, missing };
  const t = { dividendsGrossedUp: 0, taxableGains: 0, dividendCredit: 0, marginalRate: 0, effectiveRate: 0 } as Record<string, number>;
  for (const k of SUM_KEYS) t[k] = have.reduce((a, p) => a + (p[kind].computed![k] as number), 0);
  t.effectiveRate = t.totalIncome > 0 ? t.totalTax / t.totalIncome : 0;
  t.marginalRate = Math.max(...have.map((p) => p[kind].computed!.marginalRate));
  return { totals: t as unknown as Computed, counted: have.length, missing };
}
