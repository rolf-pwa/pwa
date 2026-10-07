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
