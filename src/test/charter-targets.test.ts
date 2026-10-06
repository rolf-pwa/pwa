import { describe, expect, it } from "vitest";
import { evaluateTarget, sanitizeTargets, type BalanceFigures, type CharterTarget } from "../../supabase/functions/_shared/charter-targets";

const b: BalanceFigures = {
  areas: { vineyard: 739_573, liquidity: 171_024, strategic: 61_408, philanthropic: 0, legacy: 1_537_500, liabilities: 909_000 },
  totalAssets: 2_519_505, investableAssets: 982_005, netWorth: 1_610_505, monthlySpending: null,
};
const t = (o: Partial<CharterTarget>): CharterTarget => ({ area: "liquidity", label: "Liquidity Reserve", metric: "amount", comparison: "at_least", value: 150_000, value_max: null, quote: "q", ...o });

describe("evaluateTarget", () => {
  it("at least: met above, below short", () => {
    expect(evaluateTarget(t({}), b).status).toBe("met");
    const short = evaluateTarget(t({ value: 250_000 }), b);
    expect(short.status).toBe("below");
    expect(short.summary).toMatch(/at least \$250,000\); actual \$171,024, short of the target/);
  });
  it("at most: met below, above over the limit (liabilities as % of total assets)", () => {
    expect(evaluateTarget(t({ area: "liabilities", metric: "percent_of_total_assets", comparison: "at_most", value: 40 }), b).status).toBe("met");
    expect(evaluateTarget(t({ area: "liabilities", metric: "percent_of_total_assets", comparison: "at_most", value: 30 }), b).status).toBe("above");
  });
  it("percent of investable assets uses assets less real estate", () => {
    const r = evaluateTarget(t({ area: "vineyard", metric: "percent_of_investable_assets", comparison: "at_most", value: 70 }), b);
    expect(Math.round(r.actual!)).toBe(75);
    expect(r.status).toBe("above");
  });
  it("between and plain targets (10% tolerance)", () => {
    expect(evaluateTarget(t({ comparison: "between", value: 100_000, value_max: 200_000 }), b).status).toBe("met");
    expect(evaluateTarget(t({ comparison: "target", value: 170_000 }), b).status).toBe("met");
    expect(evaluateTarget(t({ comparison: "target", value: 100_000 }), b).status).toBe("above");
  });
  it("months of spending needs a spending figure; otherwise it isn't computed", () => {
    expect(evaluateTarget(t({ metric: "months_of_spending", value: 12 }), b).status).toBe("not_computable");
    const withSpend = evaluateTarget(t({ metric: "months_of_spending", value: 12 }), { ...b, monthlySpending: 10_000 });
    expect(withSpend.status).toBe("met"); // 171,024 / 10,000 = 17.1 months
  });
  it("other / missing values are not computed, never guessed", () => {
    expect(evaluateTarget(t({ area: "other" }), b).status).toBe("not_computable");
    expect(evaluateTarget(t({ value: null }), b).status).toBe("not_computable");
  });
});

describe("sanitizeTargets", () => {
  it("keeps valid rows, normalises unknown enums to 'other'/'target', drops unlabelled rows, caps at 20", () => {
    const out = sanitizeTargets([
      { area: "liquidity", label: "L", metric: "amount", comparison: "at_least", value: 5, quote: "x" },
      { area: "bogus", label: "B", metric: "nope", comparison: "nah", value: "5" },
      { area: "legacy", label: "", value: 1 },
      "junk",
    ]);
    expect(out).toHaveLength(2);
    expect(out[1]).toMatchObject({ area: "other", metric: "other", comparison: "target", value: null });
    expect(sanitizeTargets(Array.from({ length: 30 }, () => ({ label: "x" })))).toHaveLength(20);
    expect(sanitizeTargets(null)).toEqual([]);
  });
});
