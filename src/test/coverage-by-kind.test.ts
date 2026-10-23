import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { coverageByKind, coverageSentence, lumpSumCoverage } from "../../supabase/functions/_shared/coverage-by-kind";
import { coverageSummary } from "@/shared/lib/insuranceSummary";

const POLICIES = [
  { id: "1", policy_type: "universal_life", coverage_amount: 500000 }, { id: "2", policy_type: "term", coverage_amount: 250000 },
  { id: "3", policy_type: "critical_illness", coverage_amount: 100000 }, { id: "4", policy_type: "disability", coverage_amount: 4100 },
  { id: "5", policy_type: "long_term_care", coverage_amount: 3000 }, { id: "6", policy_type: "other", coverage_amount: 10 },
];

describe("insurance in force by kind, for the advisor's reports", () => {
  it("keeps a monthly disability benefit out of the capital protected", () => {
    const c = coverageByKind(POLICIES);
    expect(c).toEqual({ life: 750000, critical_illness: 100000, disability_monthly: 4100, long_term_care: 3000, other: 10 });
    expect(lumpSumCoverage(c)).toBe(850000);
  });
  it("is worded by kind, only the kinds present", () => {
    expect(coverageSentence(coverageByKind(POLICIES))).toBe("life $750,000; critical illness $100,000; disability $4,100 a month; long-term care $3,000");
    expect(coverageSentence(coverageByKind([POLICIES[0]]))).toBe("life $500,000");
    expect(coverageSentence(undefined)).toBe("");
  });
  it("agrees with what the client sees in the portal", () => {
    const mine = coverageByKind(POLICIES), theirs = Object.fromEntries(coverageSummary(POLICIES as any).map((l) => [l.category, l.total]));
    expect(theirs.life).toBe(mine.life); expect(theirs.critical_illness).toBe(mine.critical_illness); expect(theirs.disability).toBe(mine.disability_monthly);
  });
});

describe("the reports use it", () => {
  it("builds the diagnostics' asset protection from lump sums and records the kinds", () => {
    const d = readFileSync("supabase/functions/_shared/sovereignty-diagnostics.ts", "utf8");
    expect(d).toContain("const totalInsuranceCoverage = lumpSumCoverage(insuranceCoverageByKind);");
    expect(d).toContain("insurance_coverage_by_kind: financials.insuranceCoverageByKind");
    expect(d).not.toMatch(/totalInsuranceCoverage = insurancePolicies\.reduce/);
  });
  it("shows the disability benefit on its own in both report pages, and tells the narrative model the kinds", () => {
    for (const f of ["src/modules/audit/pages/QuarterlySystemReview.tsx", "src/modules/audit/pages/StabilizationMap.tsx"]) {
      const s = readFileSync(f, "utf8");
      expect(s).toContain('label="Disability benefit"');
      expect(s).toContain("a month");
    }
    expect(readFileSync("supabase/functions/stabilization-map-generate/index.ts", "utf8")).toContain("By kind: ");
    expect(readFileSync("supabase/functions/quarterly-system-review-generate/index.ts", "utf8")).toContain("coverageText: coverageSentence(");
    expect(readFileSync("supabase/functions/_shared/quarterly-review-cards.ts", "utf8")).toContain("s.coverageText ?");
  });
});
