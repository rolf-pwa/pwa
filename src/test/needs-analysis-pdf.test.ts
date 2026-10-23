import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { dime } from "@/shared/lib/needsAnalysis";
import { needsAnalysisBlocks } from "../../supabase/functions/_shared/needs-analysis-pdf";
import { buildBrandedPdf } from "../../supabase/functions/_shared/simple-pdf";

const inputs = { debt: 20000, annualIncome: 100000, incomeYears: 10, survivorIncome: 40000, mortgage: 400000, finalExpenses: 10000, taxesAndLegal: 30000, education: 40000, lifeInsurance: 500000, liquidAssets: 50000, cppDeathBenefit: 2500 };
const results = dime(inputs);
const a = { inputs, results, note: "Reviewed with both spouses", savedAt: "2026-10-22T20:00:00Z", person: "Thomas Wolfe" };

describe("the needs analysis report", () => {
  const text = JSON.stringify(needsAnalysisBlocks(a));
  it("states the result and where each part comes from", () => {
    expect(results.need).toBe(20000 + 600000 + 400000 + 80000);
    for (const t of ["Total life insurance need:", "$1,100,000", "Available:", "$552,500", "Shortfall:", "$547,500", "Need met:", "50%"]) expect(text).toContain(t);
    expect(text).toContain("$100,000 a year, less $40,000 the survivor already earns, is $60,000, for 10 years = $600,000");
    expect(text).toContain("final expenses $10,000; taxes at death, legal and probate $30,000; education $40,000");
    expect(text).toContain("Reviewed with both spouses");
    expect(text).toContain("not itself a recommendation");
  });
  it("says surplus when the cover is more than the need", () => {
    const r = dime({ mortgage: 100000, lifeInsurance: 500000 });
    expect(JSON.stringify(needsAnalysisBlocks({ ...a, results: r, inputs: { mortgage: 100000, lifeInsurance: 500000 } }))).toContain("Surplus:");
  });
  it("builds a branded PDF", () => {
    const s = new TextDecoder("latin1").decode(buildBrandedPdf({ title: "Life Insurance Needs Analysis", footer: "f", blocks: needsAnalysisBlocks(a) }));
    expect(s.startsWith("%PDF-1.4")).toBe(true);
    expect(s).not.toContain("PROSPERWISE ADVISORS");
  });
  it("is wired: a migration for the PDF columns, the staff action and the card button", () => {
    expect(readFileSync("supabase/migrations/20261219120000_needs_analysis_pdf.sql", "utf8")).toContain("pdf_url");
    expect(readFileSync("supabase/functions/review-agent-admin/index.ts", "utf8")).toContain("naFile");
    expect(readFileSync("src/modules/crm/components/NeedsAnalysis.tsx", "utf8")).toContain("File as PDF");
  });
});
