import { describe, expect, it } from "vitest";
import { emptyLines, linesFromReturn, sanitizeLines, sanitizeReturn, taxFromLines } from "../../supabase/functions/_shared/tax-lines";
import { matchContactByName, pickReturnFiles } from "../../supabase/functions/_shared/tax-return-pick";
import { projectionFromSaved } from "../../supabase/functions/_shared/income-tax-projection";
import { withEdit } from "@/modules/crm/lib/householdTax";

describe("taxFromLines", () => {
  it("is zero tax under the basic personal amounts", () => {
    expect(taxFromLines("BC", { ...emptyLines(), government_benefits: 12000 })!.totalTax).toBe(0);
  });
  it("grosses dividends up, halves gains, and lets deductions and credit amounts reduce tax", () => {
    const base = { ...emptyLines(), employment: 40000, eligible_dividends: 10000, capital_gains: 10000 };
    const r = taxFromLines("BC", base)!;
    expect(r.totalIncome).toBe(40000 + 13800 + 5000);
    expect(r.dividendCredit).toBeGreaterThan(0);
    expect(taxFromLines("BC", { ...base, deductions: 10000 })!.totalTax).toBeLessThan(r.totalTax);
    expect(taxFromLines("BC", { ...base, credit_amounts: 8000 })!.totalTax).toBeLessThan(r.totalTax);
    expect(taxFromLines("ZZ", base)).toBeNull();
  });
  it("sanitises lines: unknown keys dropped, junk becomes 0", () => {
    expect(sanitizeLines({ employment: "x", capital_gains: 5, nope: 9, deductions: -3 })).toEqual({ ...emptyLines(), capital_gains: 5 });
  });
});

describe("a filed return as the baseline", () => {
  const ex = sanitizeReturn({ is_return: true, recipient: "COLLEEN DAWN JERCZYNSKI", tax_year: 2025, cpp_oas_income: 23200, interest_investment_income: 1000,
    dividends_taxable_total: 13800 + 1150, dividends_taxable_other: 1150, taxable_capital_gains: 5000, total_income: 50000, taxable_income: 48000, total_tax_payable: 6000 })!;
  it("backs the gross-up and inclusion rate out so the lines are actual amounts", () => {
    const l = linesFromReturn(ex);
    expect(l.eligible_dividends).toBeCloseTo(10000, 0);
    expect(l.other_dividends).toBeCloseTo(1000, 0);
    expect(l.capital_gains).toBe(10000);
    expect(l.government_benefits).toBe(23200);
  });
  it("matches a printed name to exactly one household member", () => {
    const people = [{ id: "a", name: "Colleen Jerczynski" }, { id: "b", name: "Keith Jerczynski" }];
    expect(matchContactByName("COLLEEN DAWN JERCZYNSKI", people)?.id).toBe("a");
    expect(matchContactByName("Jerczynski", people)).toBeNull();
    expect(matchContactByName(null, people)).toBeNull();
  });
  it("prefers return-like files for the year and skips other years", () => {
    const files = [{ id: "1", name: "2024 T1 return.pdf" }, { id: "2", name: "2025 T5 slip.pdf" }, { id: "3", name: "2025 Notice of Assessment.pdf" }, { id: "4", name: "scan.pdf" }];
    expect(pickReturnFiles(files, 2025).map((f) => f.id)).toEqual(["3", "4", "2"]);
  });
});

describe("saved projection feeds the audit", () => {
  it("builds the audit shape from saved lines and ignores people with no income", () => {
    const rows = [{ name: "A", province: "BC", lines: { ...emptyLines(), pension_registered: 60000, government_benefits: 10000 } }, { name: "B", province: "BC", lines: {} }];
    const p = projectionFromSaved(rows, "BC")!;
    expect(p.basis).toBe("household_tax_page");
    expect(p.taxpayers).toHaveLength(1);
    expect(p.grossIncome).toBe(70000);
    expect(p.afterTaxIncome).toBeCloseTo(70000 - p.totalTax, 1);
    expect(projectionFromSaved([], "BC")).toBeNull();
  });
});

describe("page edits", () => {
  it("marks an edited line manual and never goes negative", () => {
    const r = withEdit({ ...emptyLines() }, {}, "employment", -5);
    expect(r.lines.employment).toBe(0);
    expect(r.sources.employment).toBe("manual");
  });
});

import { householdTotals, type TaxPerson } from "@/modules/crm/lib/householdTax";

describe("household roll-up", () => {
  const comp = (income: number, tax: number) => ({ totalIncome: income, taxableIncome: income, dividendsGrossedUp: 0, taxableGains: 0, dividendCredit: 0, federalTax: tax / 2, provincialTax: tax / 2, totalTax: tax, marginalRate: tax > 0 ? 0.3 : 0, effectiveRate: income ? tax / income : 0, afterTax: income - tax });
  const col = (c: ReturnType<typeof comp> | null) => ({ saved: !!c, lines: emptyLines(), sources: {}, computed: c, sourceFile: null });
  const person = (name: string, b: ReturnType<typeof comp> | null, p: ReturnType<typeof comp> | null): TaxPerson => ({ contactId: name, name, province: "BC", hasAccounts: true, baseline: col(b), projection: col(p) });
  it("adds each person's figures, recomputes the effective rate and names anyone with none", () => {
    const people = [person("A", comp(100000, 20000), comp(110000, 22000)), person("B", comp(50000, 5000), null)];
    const proj = householdTotals(people, "projection");
    expect(proj.totals?.totalIncome).toBe(110000);
    expect(proj.missing).toEqual(["B"]);
    const base = householdTotals(people, "baseline");
    expect(base.totals?.totalTax).toBe(25000);
    expect(base.totals?.effectiveRate).toBeCloseTo(25000 / 150000);
    expect(householdTotals([person("X", null, null)], "baseline").totals).toBeNull();
  });
});
