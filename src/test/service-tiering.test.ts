// Table-driven checks of the Client Service Tier classifier against the
// exact band boundaries in "Legacy Client Service Tier & Review Cadence
// Matrix" (doc id 1uE1h4OYRVZKRzZD3k4PLh_O1BluWZV3iwTZrFPOk9P0). Pure and
// DB-free, same convention as governance-audit-calc.test.ts.
import { describe, expect, it } from "vitest";
import { classifyTier } from "../../supabase/functions/_shared/service-tiering";

describe("classifyTier", () => {
  it("classifies Tier 0 -- nil AUM with an insurance policy on file", () => {
    expect(classifyTier({ groupedAum: 0, hasRatifiedCharter: false, hasInsurancePolicy: true })).toBe("tier_0");
  });

  it("falls back to Tier 1 at nil AUM with no insurance policy", () => {
    expect(classifyTier({ groupedAum: 0, hasRatifiedCharter: false, hasInsurancePolicy: false })).toBe("tier_1");
  });

  it("classifies Tier 1 -- under $250k", () => {
    expect(classifyTier({ groupedAum: 100_000, hasRatifiedCharter: false, hasInsurancePolicy: false })).toBe("tier_1");
    expect(classifyTier({ groupedAum: 249_999, hasRatifiedCharter: true, hasInsurancePolicy: false })).toBe("tier_1");
  });

  it("splits Tier 2A vs 2B purely on Charter status, same $250k-$750k band", () => {
    expect(classifyTier({ groupedAum: 250_000, hasRatifiedCharter: true, hasInsurancePolicy: false })).toBe("tier_2a");
    expect(classifyTier({ groupedAum: 250_000, hasRatifiedCharter: false, hasInsurancePolicy: false })).toBe("tier_2b");
    expect(classifyTier({ groupedAum: 749_999, hasRatifiedCharter: true, hasInsurancePolicy: false })).toBe("tier_2a");
    expect(classifyTier({ groupedAum: 749_999, hasRatifiedCharter: false, hasInsurancePolicy: false })).toBe("tier_2b");
  });

  it("classifies Tier 3 -- $750k to $2M, regardless of Charter status", () => {
    expect(classifyTier({ groupedAum: 750_000, hasRatifiedCharter: false, hasInsurancePolicy: false })).toBe("tier_3");
    expect(classifyTier({ groupedAum: 1_999_999, hasRatifiedCharter: true, hasInsurancePolicy: false })).toBe("tier_3");
  });

  it("classifies Tier 4 -- $2M and above", () => {
    expect(classifyTier({ groupedAum: 2_000_000, hasRatifiedCharter: false, hasInsurancePolicy: false })).toBe("tier_4");
    expect(classifyTier({ groupedAum: 50_000_000, hasRatifiedCharter: true, hasInsurancePolicy: false })).toBe("tier_4");
  });
});
