import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildBrandedPdf } from "../../supabase/functions/_shared/simple-pdf";
import { monthlyPremium, planningReportBlocks, type ReportInput, type ReportPerson } from "../../supabase/functions/_shared/planning-report-rules";
import { conventionFile, DOC_FILE_NAME } from "../../supabase/functions/_shared/file-naming";
import { criticalIllness, disability } from "@/shared/lib/protectionNeeds";
import { dime } from "@/shared/lib/needsAnalysis";
import type { QuoteRow } from "../../supabase/functions/_shared/quote-rules";

const quote = (o: Partial<QuoteRow>): QuoteRow => ({ policy_type: "disability", carrier: "iA", product: "Acci-Jet illness", coverage_amount: 4100, term_years: null, premium_amount: 82.41, premium_frequency: "monthly", underwriting: null, riders: null, guarantees: null, quote_date: "2026-10-23", valid_until: null, illustration_url: null, notes: null, status: "considered", reason: null, ...o });
const saved = (inputs: object, results: object) => ({ inputs: inputs as any, results: results as any, savedAt: "2026-10-23T18:00:00Z" });

const diIn = { annualIncome: 72000, replacePercent: 70, waitingDays: 30, benefitMonths: 24, groupBenefit: 0, cppBenefit: 0, inForce: 0, hasCorporation: true, boeMonthlyExpenses: 4000, boeMonths: 12, boeInForce: 0 };
const ciIn = { annualIncome: 72000, incomeYears: 1, treatmentCosts: 25000, debts: 0, inForce: 0 };
const dimeIn = { debt: 20000, annualIncome: 72000, incomeYears: 10, survivorIncome: 0, mortgage: 300000, finalExpenses: 10000, taxesAndLegal: 0, education: 0, lifeInsurance: 100000, liquidAssets: 0, cppDeathBenefit: 2500 };

const doreen: ReportPerson = {
  name: "Doreen Example",
  analyses: { life: saved(dimeIn, dime(dimeIn)), critical_illness: saved(ciIn, criticalIllness(ciIn)), disability: saved(diIn, disability(diIn)) },
  quotes: [
    quote({ status: "recommended", reason: "it pays from day one for accidents and keeps the illness wait at 30 days" }),
    quote({ product: "Other plan", carrier: "Carrier B", premium_amount: 99, status: "rejected", reason: "costs more for the same benefit" }),
    quote({ product: "Acci-Jet overhead, accident", benefit_kind: "overhead", coverage_amount: 2000, premium_amount: 10.4, status: "recommended", reason: "protects the business's fixed costs" }),
    quote({ policy_type: "critical_illness", product: "Transition 25 illnesses, to 75", coverage_amount: 100000, premium_amount: 104.13, guarantees: "25 illnesses; Prevention+ benefit", status: "recommended", reason: "broadest cover for the price" }),
  ],
};
const sam: ReportPerson = { name: "Sam Example", analyses: { life: saved(dimeIn, dime({ ...dimeIn, lifeInsurance: 2000000 })) }, quotes: [] };
const base = (o: Partial<ReportInput> = {}): ReportInput => ({ household: "Example", preparedOn: "October 23, 2026", coverNote: null, kinds: ["life", "critical_illness", "disability"], includeOptions: true, people: [doreen, sam], ...o });
const text = (i: ReportInput) => JSON.stringify(planningReportBlocks(i));

describe("the planning report", () => {
  it("opens with who it is for, and the cover note when there is one", () => {
    expect(text(base())).toContain("Prepared for Doreen Example and Sam Example by Rolf Issler");
    expect(text(base())).not.toContain("A note from Rolf");
    expect(text(base({ coverNote: "Thank you for Tuesday." }))).toContain("A note from Rolf");
  });
  it("shows where each person stands, per kind, from their saved analysis", () => {
    const t = text(base());
    expect(t).toContain("Doreen Example: Life insurance");
    expect(t).toContain("Doreen Example: Critical illness");
    expect(t).toContain("Doreen Example: Disability income");
    expect(t).toContain("Doreen Example: Business overhead expense");
    expect(t).toContain("Monthly income to protect: $4,200 a month (70% of gross income of $72,000 a year)");
    expect(t).toContain("Lump sum needed: $97,000");
    expect(t).toContain("Covered, with a surplus of"); // Sam's life cover exceeds the need
  });
  it("says so when a person has no analysis for a kind in the report", () => {
    expect(text(base())).toContain("Sam Example: no critical illness needs analysis has been saved yet.");
  });
  it("recommends the quotes marked recommended, with the reason, and what they cost together", () => {
    const t = text(base());
    expect(t).toContain("Doreen Example: Disability insurance, iA Acci-Jet illness");
    expect(t).toContain("Why we recommend it: it pays from day one");
    expect(t).toContain("Monthly benefit: $4,100");
    expect(t).toContain("Doreen Example: Business overhead expense, iA Acci-Jet overhead, accident");
    expect(t).toContain("Doreen Example, recommended cover:");
    expect(t).toContain("$196.94 a month"); // 82.41 + 10.40 + 104.13
    expect(t).toContain("All recommended cover together:");
  });
  it("notes a need that has no recommendation yet", () => {
    const t = text(base({ people: [{ ...doreen, quotes: [] }] }));
    expect(t).toContain("we have not yet made a recommendation for disability");
    expect(t).toContain("No recommendations have been made yet.");
  });
  it("shows the options compared only when asked, and only where there are at least two", () => {
    expect(text(base())).toContain("Options we compared");
    expect(text(base())).toContain("Carrier B, Other plan (not chosen)");
    expect(text(base())).toContain("Why not: costs more for the same benefit");
    expect(text(base({ includeOptions: false }))).not.toContain("Options we compared");
    expect(text(base({ people: [{ ...doreen, quotes: [doreen.quotes[0]] }] }))).not.toContain("options compared");
  });
  it("leaves out the kinds that are not chosen", () => {
    const t = text(base({ kinds: ["disability"] }));
    expect(t).toContain("Disability income");
    expect(t).not.toContain("Doreen Example: Life insurance");
    expect(t).not.toContain("Critical illness insurance");
  });
  it("converts premiums to a monthly amount", () => {
    expect(monthlyPremium({ premium_amount: 1200, premium_frequency: "annual" })).toBe(100);
    expect(monthlyPremium({ premium_amount: 500, premium_frequency: "single" })).toBeNull();
  });
  it("builds a PDF in the house look and files it under the naming convention", () => {
    const pdf = buildBrandedPdf({ title: "Insurance Planning Report", subtitle: "Doreen Example", footer: "ProsperWise Advisors", blocks: planningReportBlocks(base()) });
    expect(new TextDecoder("latin1").decode(pdf.subarray(0, 5))).toBe("%PDF-");
    expect(conventionFile("2026-10-23", [{ first_name: "Doreen", last_name: "Example" }], DOC_FILE_NAME.planning_report)).toBe("26-10-23_Example_D_Insurance Planning Report.pdf");
  });
});

describe("wiring", () => {
  it("has a table with grants, handler actions, a page, a route and a menu item", () => {
    const mig = readFileSync("supabase/migrations/20261228120000_insurance_reports.sql", "utf8");
    expect(mig).toContain("GRANT SELECT ON public.insurance_reports TO authenticated");
    expect(mig).toContain("GRANT ALL ON public.insurance_reports TO service_role");
    const h = readFileSync("supabase/functions/review-agent-admin/index.ts", "utf8");
    for (const a of ['"rpList"', '"rpPreview"', '"rpFile"']) expect(h).toContain(a);
    expect(readFileSync("src/App.tsx", "utf8")).toContain('path="report"');
    expect(readFileSync("src/modules/insurance/InsuranceLayout.tsx", "utf8")).toContain('label: "Planning report"');
    expect(readFileSync("src/modules/insurance/InsuranceHouseholdPages.tsx", "utf8")).toContain("<PlanningReport");
  });
});
