import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { INSURANCE_STAGES, isStage, stageLabel } from "@/shared/lib/insurancePipeline";

const read = (p: string) => readFileSync(p, "utf8");

describe("insurance workspace", () => {
  it("has the five stages in order", () => {
    expect(INSURANCE_STAGES.map((s) => s.label)).toEqual(["New Lead", "Discovery", "Needs Analysis", "Recommendation", "Coverage Agreed"]);
    expect(stageLabel("needs_analysis")).toBe("Needs Analysis");
    expect(isStage("discovery")).toBe(true);
    expect(isStage("won")).toBe(false);
  });
  it("keeps the stage list in the migration in step with the code", () => {
    const m = read("supabase/migrations/20261216120000_insurance_pipeline.sql");
    for (const s of INSURANCE_STAGES) expect(m).toContain(`'${s.key}'`);
    expect(m).toMatch(/GRANT [^;]+ TO authenticated;/);
    expect(m).toMatch(/GRANT ALL ON public\.insurance_pipeline TO service_role;/);
  });
  it("is its own area with a way back to the advisor site, behind login", () => {
    const app = read("src/App.tsx");
    expect(app).toMatch(/path="\/insurance" element=\{<ProtectedRoute><InsuranceLayout \/><\/ProtectedRoute>\}/);
    for (const p of ['path="policies"', 'path="fact-find"', 'path="needs"', 'path="quoting"', 'path="compliance"']) expect(app).toContain(p);
    const layout = read("src/modules/insurance/InsuranceLayout.tsx");
    expect(layout).toContain("/households/${householdId}");
    expect(layout).not.toContain("AppLayout");
  });
  it("is linked from the advisor sidebar and from the household's Insurance tab", () => {
    expect(read("src/shared/components/AppSidebar.tsx")).toContain('to: "/insurance"');
    expect(read("src/modules/crm/components/InsuranceTab.tsx")).toContain("Open the insurance workspace");
  });
});

describe("the roadmap points to where each item is done", () => {
  it("links the fact find, needs analysis, alternatives and illustration items to their pages", () => {
    const r = read("src/modules/insurance/ComplianceRoadmap.tsx");
    for (const t of ['fact_find: { to: "fact-find"', 'needs_analysis: { to: "needs"', 'alternatives: { to: "quoting"', 'illustration: { to: "quoting"', "work-page-link"]) expect(r).toContain(t);
  });
});
