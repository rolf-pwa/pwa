import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { alternativesText, annualCost, compare, costPer1000, type Quote } from "@/shared/lib/quotes";
import { annualCost as sAnnual, costPer1000 as sPer1000, quoteBlocks, type QuoteRow } from "../../supabase/functions/_shared/quote-rules";
import { buildBrandedPdf } from "../../supabase/functions/_shared/simple-pdf";

const q = (o: Partial<Quote>): Quote => ({ id: "x", policy_type: "term", carrier: "iA Financial Group", product: "20-year term", coverage_amount: 500000, term_years: 20, premium_amount: 85, premium_frequency: "monthly", underwriting: "Preferred non-smoker", riders: null, guarantees: null, quote_date: "2026-10-20", valid_until: null, illustration_url: null, notes: null, status: "considered", reason: null, ...o });

describe("comparing quotes", () => {
  it("works out the yearly cost and the cost per $1,000 of coverage", () => {
    expect(annualCost(q({}))).toBe(1020);
    expect(costPer1000(q({}))).toBeCloseTo(2.04, 5);
    expect(annualCost(q({ premium_frequency: "single" }))).toBeNull();
    expect(costPer1000(q({ coverage_amount: null }))).toBeNull();
    expect(annualCost(q({ premium_frequency: "quarterly", premium_amount: 300 }))).toBe(1200);
  });
  it("marks the cheapest option that has not been rejected, only when there is a choice", () => {
    const rows = compare([q({ id: "a" }), q({ id: "b", carrier: "Canada Protection Plan", premium_amount: 70 }), q({ id: "c", premium_amount: 40, status: "rejected" })]);
    expect(rows.find((r) => r.quote.id === "b")!.cheapest).toBe(true);
    expect(rows.find((r) => r.quote.id === "c")!.cheapest).toBe(false);
    expect(compare([q({})])[0].cheapest).toBe(false);
  });
  it("writes the alternatives for the letter: the options, then why the recommended one", () => {
    const t = alternativesText([q({ id: "a", status: "recommended", reason: "it is the lowest cost and convertible" }), q({ id: "b", carrier: "Assumption Life", product: "10-year term", premium_amount: 60, coverage_amount: 500000 })]);
    expect(t).toContain("We compared 2 options:");
    expect(t).toContain("Assumption Life 10-year term for $500,000 at $60 a month");
    expect(t).toContain("We recommend the iA Financial Group 20-year term because it is the lowest cost and convertible.");
    expect(alternativesText([])).toBe("");
  });
  it("keeps the client and server calculations in step", () => {
    for (const o of [{}, { premium_frequency: "annual", premium_amount: 900 }, { coverage_amount: 250000 }, { premium_frequency: "single" }]) { const x = q(o as any); expect(sAnnual(x)).toBe(annualCost(x)); expect(sPer1000(x)).toBe(costPer1000(x)); }
  });
});

describe("the Alternatives Considered report", () => {
  const rows: QuoteRow[] = [q({ status: "recommended", reason: "Lowest cost with a conversion option", illustration_url: "https://drive.google.com/file/d/abc/view" }), q({ carrier: "Assumption Life", product: "10-year term", premium_amount: 60, status: "rejected", reason: "Expires before the mortgage is paid" })] as any;
  const blocks = quoteBlocks({ person: "Thomas Wolfe", typeLabel: "Term Life", quotes: rows, needLine: "A total need of $1,100,000.", preparedOn: "2026-10-23" });
  const text = JSON.stringify(blocks);
  it("lists each option with its cost, marks the recommendation and says why", () => {
    for (const t of ["Option 1: iA Financial Group, 20-year term  (RECOMMENDED)", "Cost per $1,000 of coverage: $2.04 a year", "Why this one: Lowest cost with a conversion option", "(not chosen)", "Why not: Expires before the mortgage is paid", "A total need of $1,100,000.", "is recommended: Lowest cost with a conversion option."]) expect(text).toContain(t);
  });
  it("builds a branded PDF", () => { expect(new TextDecoder("latin1").decode(buildBrandedPdf({ eyebrow: "ProsperWise Advisors", title: "Alternatives Considered", footer: "f", blocks })).startsWith("%PDF-1.4")).toBe(true); });
});

describe("wiring", () => {
  it("has a migration with grants, one recommended quote per person and kind, and the staff action", () => {
    const m = readFileSync("supabase/migrations/20261221120000_insurance_quotes.sql", "utf8");
    expect(m).toMatch(/GRANT SELECT, INSERT, UPDATE, DELETE ON public\.insurance_quotes TO authenticated;/);
    expect(m).toMatch(/GRANT ALL ON public\.insurance_quotes TO service_role;/);
    expect(m).toContain("WHERE status = 'recommended'");
    expect(readFileSync("supabase/functions/review-agent-admin/index.ts", "utf8")).toContain("qFile");
    expect(readFileSync("src/modules/insurance/InsuranceHouseholdPages.tsx", "utf8")).toContain("QuotingWorkspace");
  });
});
