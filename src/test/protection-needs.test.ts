import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { CI_DEFAULTS, DISABILITY_DEFAULTS, criticalIllness, disability } from "@/shared/lib/protectionNeeds";
import { criticalIllnessBlocks, disabilityBlocks } from "../../supabase/functions/_shared/needs-analysis-pdf";
import { DOC_FILE_NAME } from "../../supabase/functions/_shared/file-naming";

describe("disability need", () => {
  it("defaults to 70% of gross income, a 30-day wait and 2 years of benefits", () => {
    expect(DISABILITY_DEFAULTS).toMatchObject({ replacePercent: 70, waitingDays: 30, benefitMonths: 24 });
  });
  it("replaces 70% of monthly income less group, CPP and policies in force", () => {
    const r = disability({ annualIncome: 120000, groupBenefit: 2000, cppBenefit: 1000, inForce: 500 });
    expect(r.monthlyIncome).toBe(10000);
    expect(r.target).toBe(7000);
    expect(r.available).toBe(3500);
    expect(r.gap).toBe(3500);
    expect(r.percentMet).toBe(50);
    expect(r.exposure).toBe(3500 * 24);
    expect(r.waitingBridge).toBe(7000);
    expect(r.boe).toBeNull();
  });
  it("shows a surplus, never a negative gap, when cover exceeds the need", () => {
    const r = disability({ annualIncome: 60000, inForce: 5000 });
    expect(r.gap).toBe(0);
    expect(r.surplus).toBe(1500);
    expect(r.percentMet).toBe(100);
  });
  it("works out business overhead expense separately, and only for a person with a corporation", () => {
    const base = { annualIncome: 120000, boeMonthlyExpenses: 8000, boeInForce: 2000 };
    expect(disability(base).boe).toBeNull();
    const r = disability({ ...base, hasCorporation: true });
    expect(r.boe).toEqual({ need: 8000, gap: 6000, percentMet: 25, exposure: 6000 * 12 });
    expect(r.gap).toBe(disability(base).gap); // the personal figures do not change
  });
  it("ignores junk and caps the share at 100%", () => {
    const r = disability({ annualIncome: -5 as any, replacePercent: 250 });
    expect(r.target).toBe(0);
    expect(disability({ annualIncome: 12000, replacePercent: 250 }).target).toBe(1000);
  });
});

describe("critical illness need", () => {
  it("defaults to a year of income plus $25,000 of recovery costs, with debts left out", () => {
    expect(CI_DEFAULTS).toMatchObject({ incomeYears: 1, treatmentCosts: 25000, debts: 0 });
    const r = criticalIllness({ annualIncome: 120000, inForce: 50000 });
    expect(r.need).toBe(145000);
    expect(r.shortfall).toBe(95000);
    expect(r.percentMet).toBe(34);
  });
  it("adds debts when asked and shows a surplus when over-covered", () => {
    expect(criticalIllness({ annualIncome: 100000, debts: 40000 }).need).toBe(165000);
    const r = criticalIllness({ annualIncome: 50000, inForce: 200000 });
    expect(r.shortfall).toBe(0);
    expect(r.surplus).toBe(125000);
  });
});

describe("the reports", () => {
  const saved = (inputs: object, results: object) => ({ inputs, results, savedAt: "2026-10-23T12:00:00Z", person: "Justin Santos", note: null });
  it("states the disability assumptions and the BOE part only when there is one", () => {
    const inputs = { annualIncome: 120000, replacePercent: 70, waitingDays: 30, benefitMonths: 24, groupBenefit: 2000, cppBenefit: 1000, inForce: 500, hasCorporation: true, boeMonthlyExpenses: 8000, boeMonths: 12, boeInForce: 2000 };
    const text = JSON.stringify(disabilityBlocks(saved(inputs, disability(inputs))));
    expect(text).toContain("Monthly income to protect");
    expect(text).toContain("70%");
    expect(text).toContain("30 days");
    expect(text).toContain("Business overhead expense (BOE)");
    const none = { ...inputs, hasCorporation: false };
    expect(JSON.stringify(disabilityBlocks(saved(none, disability(none))))).not.toContain("Business overhead");
  });
  it("states the critical illness lump sum", () => {
    const inputs = { annualIncome: 120000, incomeYears: 1, treatmentCosts: 25000, debts: 0, inForce: 50000 };
    const text = JSON.stringify(criticalIllnessBlocks(saved(inputs, criticalIllness(inputs))));
    expect(text).toContain("Lump sum needed");
    expect(text).toContain("$145,000");
    expect(text).toContain("Shortfall");
  });
});

describe("wiring", () => {
  it("lets the table hold all three methods and files each PDF under its own name", () => {
    expect(readFileSync("supabase/migrations/20261226120000_needs_analysis_methods.sql", "utf8")).toContain("('dime', 'disability', 'critical_illness')");
    expect(DOC_FILE_NAME.needs_analysis_disability).toBe("Disability Needs Analysis");
    expect(DOC_FILE_NAME.needs_analysis_critical_illness).toBe("Critical Illness Needs Analysis");
    const svc = readFileSync("supabase/functions/_shared/insurance-doc-service.ts", "utf8");
    expect(svc).toContain('a.method === "disability"');
    expect(svc).toContain("kind.docName");
  });
  it("shows both cards after the life one on the Insurance tab", () => {
    const tab = readFileSync("src/modules/crm/components/InsuranceTab.tsx", "utf8");
    expect(tab).toContain("<DisabilityNeeds");
    expect(tab).toContain("<CriticalIllnessNeeds");
  });
});
