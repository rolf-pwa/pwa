import { describe, expect, it } from "vitest";
import { evaluateTargets, incomeStructure, sanitizeIncomeSources, type BalanceFigures, type CharterTarget } from "../../supabase/functions/_shared/charter-targets";

const t = (label: string, value: number, area: CharterTarget["area"] = "vineyard"): CharterTarget => ({ area, label, metric: "annual_amount", comparison: "target", value, value_max: null, quote: "" });
const fig = (withdrawnYtd: number | null): BalanceFigures => ({ areas: { vineyard: 1, liquidity: 1, strategic: 1, philanthropic: 0, legacy: 0, liabilities: 0 }, totalAssets: 1, investableAssets: 1, netWorth: 1, monthlySpending: null, withdrawnYtd });
const sources = sanitizeIncomeSources([
  { label: "Portfolio withdrawals and liquidity draws", kind: "capital_withdrawals", annual_amount: 100000, quote: "" },
  { label: "Government Benefits", kind: "government_benefits", annual_amount: 23200, quote: "" },
]);

describe("Charter income structure", () => {
  it("splits the income into capital-funded and outside parts", () => {
    const s = incomeStructure(sources, 96162)!;
    expect(s.totalIncome).toBe(123200);
    expect(s.capitalRequired).toBe(100000);
    expect(s.externalTotal).toBe(23200);
    expect(s.capitalRemaining).toBe(3838);
  });
  it("is null without both a capital part and an outside part", () => {
    expect(incomeStructure(sources.slice(0, 1), 0)).toBeNull();
  });
  it("compares withdrawals with the capital part only, not the total income", () => {
    const r = evaluateTargets([t("Target Annual Income", 123200), t("Yield requirement", 100000), t("Lifestyle", 100000, "other"), t("Debt budget", 41000, "liabilities")], fig(96162), sources);
    const cap = r.find((x) => x.label.startsWith("Drawn from capital"))!;
    expect(cap.status).toBe("info");
    expect(cap.summary).toContain("96%");
    expect(r.some((x) => x.label === "Target Annual Income" || x.label === "Lifestyle")).toBe(false);
    expect(r.some((x) => x.label === "Government Benefits")).toBe(true);
    expect(r.some((x) => x.label === "Debt budget")).toBe(true);
  });
  it("flags only an overdrawn capital part", () => {
    const r = evaluateTargets([], fig(105000), sources);
    expect(r.find((x) => x.label.startsWith("Drawn from capital"))!.status).toBe("above");
  });
  it("leaves targets alone when no structure is stated", () => {
    expect(evaluateTargets([t("Income", 123200)], fig(96162), []).map((x) => x.label)).toEqual(["Income"]);
  });
});
