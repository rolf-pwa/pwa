import { describe, expect, it } from "vitest";
import { projectIncomeTax } from "../../supabase/functions/_shared/income-tax-projection";

const acct = (type: string, amount: number, current = 100000, book = 50000, owner: string | null = "Colleen") => ({ owner, accountType: type, amount, currentValue: current, bookValue: book });

describe("income tax projection", () => {
  it("taxes a registered withdrawal in full and a non-registered one only on its gain", () => {
    const r = projectIncomeTax({ province: "BC", accounts: [acct("RRIF", 50000)], benefitsTotal: 0 })!;
    expect(r.taxpayers[0].taxableIncome).toBe(50000);
    const n = projectIncomeTax({ province: "BC", accounts: [acct("Non-registered", 50000)], benefitsTotal: 0 })!;
    expect(n.taxpayers[0].taxableGains).toBe(12500); // half gain share x 50% inclusion
    expect(n.totalTax).toBeLessThan(r.totalTax);
  });
  it("does not tax a TFSA", () => {
    const r = projectIncomeTax({ province: "BC", accounts: [acct("TFSA", 40000)], benefitsTotal: 0 })!;
    expect(r.totalTax).toBe(0);
    expect(r.afterTaxIncome).toBe(40000);
  });
  it("adds government benefits as taxable income and reports gross and after-tax", () => {
    const r = projectIncomeTax({ province: "BC", accounts: [acct("Non-registered", 100000)], benefitsTotal: 23200 })!;
    expect(r.grossIncome).toBe(123200);
    expect(r.taxpayers[0].taxableIncome).toBe(23200 + 25000);
    expect(r.afterTaxIncome).toBeCloseTo(123200 - r.totalTax, 2);
    expect(r.totalTax).toBeGreaterThan(0);
  });
  it("treats a non-registered account with no book value as return of capital and says so", () => {
    const r = projectIncomeTax({ province: "BC", accounts: [acct("Non-registered", 30000, 100000, 0)], benefitsTotal: 0 })!;
    expect(r.totalTax).toBe(0);
    expect(r.notes.join(" ")).toContain("book value");
  });
  it("splits benefits between taxpayers and returns null for an unknown province", () => {
    const r = projectIncomeTax({ province: "BC", accounts: [acct("RRIF", 20000, 1, 1, "A"), acct("RRIF", 20000, 1, 1, "B")], benefitsTotal: 20000 })!;
    expect(r.taxpayers.map((t) => t.benefits)).toEqual([10000, 10000]);
    expect(projectIncomeTax({ province: "ZZ", accounts: [], benefitsTotal: 1 })).toBeNull();
  });
});

import { mixFromSlips, sanitizeSlips } from "../../supabase/functions/_shared/tax-slip-mix";

describe("tax slip mix", () => {
  const slips = sanitizeSlips([
    { slip_type: "T3", tax_year: 2025, interest_and_other_income: 1000, eligible_dividends: 3000, other_dividends: 0, capital_gains: 4000, return_of_capital: 2000 },
    { slip_type: "T5", tax_year: 2025, interest_and_other_income: 0, eligible_dividends: 0, other_dividends: 0, capital_gains: 0, return_of_capital: 0 },
    { slip_type: "T4", tax_year: 2025, interest_and_other_income: 99999 },
    { slip_type: "T3", tax_year: 2024, capital_gains: 5000 },
  ]);
  it("totals only last year's income slips into shares", () => {
    const m = mixFromSlips(slips, 2025)!;
    expect(m.slipCount).toBe(2);
    expect(m.shares.capitalGains).toBeCloseTo(0.4);
    expect(m.shares.eligibleDividends).toBeCloseTo(0.3);
    expect(mixFromSlips(slips, 2023)).toBeNull();
  });
  it("taxes dividends grossed up less the credit, gains at half, and ignores return of capital", () => {
    const mix = mixFromSlips(slips, 2025)!;
    const withMix = projectIncomeTax({ province: "BC", accounts: [acct("Non-registered", 100000)], benefitsTotal: 0, mix })!;
    const t = withMix.taxpayers[0];
    expect(withMix.basis).toBe("tax_slips");
    expect(t.dividendsGrossedUp).toBeCloseTo(30000 * 1.38, 0);
    expect(t.taxableGains).toBeCloseTo(20000, 0);
    expect(t.taxableIncome).toBeCloseTo(10000 + 41400 + 20000, 0);
    expect(t.dividendCredit).toBeGreaterThan(0);
    expect(projectIncomeTax({ province: "BC", accounts: [acct("Non-registered", 100000)], benefitsTotal: 0 })!.basis).toBe("unrealised_gain");
  });
});
