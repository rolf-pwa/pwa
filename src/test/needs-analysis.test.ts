import { readFileSync, existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { dime, splitLiabilities } from "@/shared/lib/needsAnalysis";

describe("DIME life insurance need", () => {
  it("adds debt, income x years, mortgage and estate, and nets off what is available", () => {
    const r = dime({ debt: 20000, annualIncome: 100000, incomeYears: 10, mortgage: 400000, finalExpenses: 10000, taxesAndLegal: 30000, education: 40000, lifeInsurance: 500000, liquidAssets: 50000, cppDeathBenefit: 2500 });
    expect(r).toMatchObject({ debt: 20000, income: 1000000, mortgage: 400000, estate: 80000, need: 1500000, available: 552500, shortfall: 947500, surplus: 0, percentMet: 37 });
  });
  it("takes the survivor's income off the income to replace, never below zero", () => {
    expect(dime({ annualIncome: 100000, survivorIncome: 40000, incomeYears: 10 }).income).toBe(600000);
    expect(dime({ annualIncome: 50000, survivorIncome: 80000, incomeYears: 10 }).income).toBe(0);
  });
  it("shows a surplus and 100% met when cover exceeds the need", () => {
    const r = dime({ mortgage: 100000, lifeInsurance: 500000 });
    expect(r.shortfall).toBe(0);
    expect(r.surplus).toBeGreaterThan(0);
    expect(r.percentMet).toBe(100);
  });
  it("uses the defaults (10 years, $10,000 final expenses, $2,500 CPP) and ignores bad numbers", () => {
    const r = dime({ annualIncome: Number.NaN, debt: -5 });
    expect(r.need).toBe(10000);
    expect(r.available).toBe(2500);
  });
  it("splits liabilities into the mortgage and everything else", () => {
    expect(splitLiabilities([{ liability_type: "mortgage", current_balance: 300000 }, { liability_type: "credit_card", current_balance: "2000" }, { liability_type: "line_of_credit", current_balance: 5000 }])).toEqual({ debt: 7000, mortgage: 300000 });
  });
  it("is saved by a migration with its grants, and shown on the Insurance tab", () => {
    const m = readFileSync("supabase/migrations/20261215120000_insurance_needs_analyses.sql", "utf8");
    expect(m).toMatch(/GRANT [^;]+ TO authenticated;/);
    expect(m).toMatch(/GRANT ALL ON public\.insurance_needs_analyses TO service_role;/);
    expect(existsSync("src/modules/crm/components/NeedsAnalysis.tsx")).toBe(true);
    expect(readFileSync("src/modules/crm/components/InsuranceTab.tsx", "utf8")).toContain("<NeedsAnalysis");
  });
});
