import { describe, it, expect } from "vitest";
import { validateModels } from "../../supabase/functions/_shared/ia-model-parse";

const good = () => ({
  as_of: "2026-05-31",
  portfolios: [
    { profile: "prudent", income_min: 65, income_max: 100, equity_min: 0, equity_max: 35, fixed_income_weight: 70, funds: [{ name: "Fixed income managed portfolio (iA)", weight: 70 }, { name: "Canadian Equity Growth (iA)", weight: 10 }, { name: "Fidelity Insights", weight: 10 }, { name: "Fidelity Global Concentrated Equity", weight: 10 }] },
    { profile: "moderate", income_min: 50, income_max: 70, equity_min: 30, equity_max: 50, fixed_income_weight: 55, funds: [{ name: "Fixed income managed portfolio (iA)", weight: 55 }, { name: "Canadian Equity Growth (iA)", weight: 15 }, { name: "Fidelity Insights", weight: 20 }, { name: "Fidelity Global Concentrated Equity", weight: 10 }] },
    { profile: "balanced", income_min: 35, income_max: 55, equity_min: 45, equity_max: 65, fixed_income_weight: 40, funds: [{ name: "Fixed income managed portfolio (iA)", weight: 40 }, { name: "Canadian Equity Growth (iA)", weight: 10 }, { name: "Fidelity Canadian Opportunities", weight: 10 }, { name: "Fidelity Insights", weight: 20 }, { name: "Fidelity Global Concentrated Equity", weight: 20 }] },
    { profile: "growth", income_min: 20, income_max: 40, equity_min: 60, equity_max: 80, fixed_income_weight: 25, funds: [{ name: "Fixed income managed portfolio (iA)", weight: 25 }, { name: "Canadian Equity Growth (iA)", weight: 15 }, { name: "Fidelity Canadian Opportunities", weight: 10 }, { name: "Fidelity Insights", weight: 25 }, { name: "Fidelity Global Concentrated Equity", weight: 25 }] },
    { profile: "aggressive", income_min: 0, income_max: 25, equity_min: 75, equity_max: 100, fixed_income_weight: 0, funds: [{ name: "Canadian Equity Growth (iA)", weight: 15 }, { name: "Fidelity Canadian Opportunities", weight: 15 }, { name: "Fidelity Insights", weight: 30 }, { name: "Fidelity Global Concentrated Equity", weight: 30 }, { name: "Fidelity Global Innovators", weight: 10 }] },
  ],
});

describe("reading iA's model portfolios", () => {
  it("accepts the May 31, 2026 document as read", () => {
    const v = validateModels(good(), "2026-10-14");
    expect(v.errors).toEqual([]);
    expect(v.ok).toBe(true);
    expect(v.parsed.asOf).toBe("2026-05-31");
    expect(v.parsed.models.map((m) => m.incomeTarget)).toEqual([70, 55, 40, 25, 0]);
    expect(v.warnings).toEqual([]);
  });
  it("refuses weights that do not add up, a missing profile, an unreadable date and a future date", () => {
    const g = good(); g.portfolios[2].funds[0].weight = 30;
    expect(validateModels(g, "2026-10-14").errors.some((e) => /Balanced: the fund weights add up to 90/.test(e))).toBe(true);
    const m = good(); m.portfolios.pop();
    expect(validateModels(m, "2026-10-14").errors).toContain("The Aggressive portfolio was not found.");
    const d = good(); (d as any).as_of = "May 2026";
    expect(validateModels(d, "2026-10-14").ok).toBe(false);
    expect(validateModels(good(), "2026-01-01").errors.some((e) => /in the future/.test(e))).toBe(true);
  });
  it("warns when ranges do not mirror or the fixed income weight is outside its range", () => {
    const g = good(); g.portfolios[2].equity_max = 90;
    expect(validateModels(g, "2026-10-14").warnings.some((w) => /do not mirror/.test(w))).toBe(true);
    const h = good(); h.portfolios[3].fixed_income_weight = 60;
    expect(validateModels(h, "2026-10-14").warnings.some((w) => /outside its own income range/.test(w))).toBe(true);
  });
  it("refuses an unreadable range or an empty fund list", () => {
    const g = good(); (g.portfolios[0] as any).income_min = null;
    expect(validateModels(g, "2026-10-14").errors.some((e) => /Prudent: the income and equity ranges could not be read/.test(e))).toBe(true);
    const h = good(); h.portfolios[1].funds = [];
    expect(validateModels(h, "2026-10-14").errors.some((e) => /Moderate: no funds were read/.test(e))).toBe(true);
  });
});
