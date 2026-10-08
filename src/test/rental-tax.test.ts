import { describe, expect, it } from "vitest";
import { emptyLines, linesFromReturn, sanitizeLines, sanitizeReturn, taxFromLines } from "../../supabase/functions/_shared/tax-lines";
import { netRental, summariseRental } from "../../supabase/functions/_shared/rental-income";
import { projectIncomeTax, projectionFromSaved } from "../../supabase/functions/_shared/income-tax-projection";

const year = (o: Record<string, number>) => ({ property_id: "p1", tax_year: 2026, rent_collected: 0, property_tax: 0, insurance: 0, repairs_maintenance: 0, management_fees: 0, utilities: 0, mortgage_interest: 0, other_expenses: 0, ...o });

describe("rental income in the tax model", () => {
  it("is taxed as ordinary income, and a rental loss reduces it", () => {
    const base = { ...emptyLines(), employment: 50000 };
    const withRent = taxFromLines("BC", { ...base, rental_income: 15000 })!;
    const withLoss = taxFromLines("BC", { ...base, rental_income: -5000 })!;
    expect(withRent.totalIncome).toBe(65000);
    expect(withLoss.totalIncome).toBe(45000);
    expect(withRent.totalTax).toBeGreaterThan(taxFromLines("BC", base)!.totalTax);
    expect(withLoss.totalTax).toBeLessThan(taxFromLines("BC", base)!.totalTax);
  });
  it("lets only the rental line go negative", () => {
    expect(sanitizeLines({ rental_income: -300, employment: -5 })).toMatchObject({ rental_income: -300, employment: 0 });
  });
  it("reads line 12600 from a return into its own line, not interest", () => {
    const ex = sanitizeReturn({ is_return: true, interest_investment_income: 1000, rental_income: 12000 })!;
    const l = linesFromReturn(ex);
    expect(l.rental_income).toBe(12000);
    expect(l.interest_other).toBe(1000);
  });
});

describe("rental summary", () => {
  const props = [{ id: "p1", name: "Duplex", net_income_use: "debt_paydown" as const, paydown_liability_id: "l1" }, { id: "p2", name: "Suite", net_income_use: "household" as const, paydown_liability_id: null }];
  const owners = [{ property_id: "p1", contact_id: "a", ownership_pct: 60 }, { property_id: "p1", contact_id: "b", ownership_pct: 40 }, { property_id: "p2", contact_id: "a", ownership_pct: 100 }];
  it("nets each property, splits by owner and sends income to the household or to debt", () => {
    const s = summariseRental(props, owners, [year({ rent_collected: 30000, property_tax: 5000 }), year({ property_id: "p2", rent_collected: 12000, insurance: 2000 })], 2026)!;
    expect(netRental(year({ rent_collected: 30000, property_tax: 5000 }))).toBe(25000);
    expect(s.net).toBe(35000);
    expect(s.toPaydown).toBe(25000);
    expect(s.toHousehold).toBe(10000);
    expect(s.byContact).toEqual({ a: 25000, b: 10000 });
  });
  it("is null when no property has a row for the year", () => {
    expect(summariseRental(props, owners, [year({ tax_year: 2025, rent_collected: 1 })], 2026)).toBeNull();
  });
});

describe("rental income in the projection", () => {
  const acct = { owner: "Colleen", accountType: "RRIF", amount: 40000, currentValue: 1, bookValue: 1 };
  it("adds rental income to gross income, outside the draws", () => {
    const p = projectIncomeTax({ province: "BC", accounts: [acct], benefitsTotal: 10000, rentalByOwner: { Colleen: 15000 } })!;
    expect(p.totalRental).toBe(15000);
    expect(p.totalDraws).toBe(40000);
    expect(p.grossIncome).toBe(65000);
    expect(p.taxpayers[0].taxableIncome).toBe(65000);
  });
  it("counts rental in a saved projection without calling it a withdrawal", () => {
    const p = projectionFromSaved([{ name: "Colleen", province: "BC", lines: { ...emptyLines(), pension_registered: 40000, government_benefits: 10000, rental_income: 15000 } }], "BC")!;
    expect(p.totalRental).toBe(15000);
    expect(p.totalDraws).toBe(40000);
    expect(p.grossIncome).toBe(65000);
  });
});
