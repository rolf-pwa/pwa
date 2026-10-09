import { describe, it, expect } from "vitest";
import { groupPolicies } from "@/shared/lib/insurance";

const row = (id: string, type: string, cov: number, renewal: string | null = null, num: string | null = "9571792203") =>
  ({ id, contact_id: "c1", policy_number: num, insured_name: "HERMAN PETERS", policy_type: type, coverage_amount: cov, renewal_date: renewal });

describe("groupPolicies", () => {
  it("nests term riders under the Universal Life base, soonest renewal first, and sums coverage", () => {
    const [g, ...rest] = groupPolicies([
      row("t3", "term", 545000, "2052-02-08"), row("ul", "universal_life", 170000), row("t1", "term", 182500, "2032-02-08"), row("t2", "term", 370500, "2042-02-08"),
    ]);
    expect(rest).toHaveLength(0);
    expect(g.base.id).toBe("ul");
    expect(g.riders.map((r) => r.id)).toEqual(["t1", "t2", "t3"]);
    expect(g.totalCoverage).toBe(1268000);
  });
  it("keeps different policy numbers and number-less rows apart, in first-seen order", () => {
    const groups = groupPolicies([row("a", "term", 1, null, "P-1"), row("b", "term", 2, null, null), row("c", "whole_life", 3, null, "P-2"), row("d", "term", 4, null, null)]);
    expect(groups.map((g) => g.base.id)).toEqual(["a", "b", "c", "d"]);
  });
  it("uses the largest coverage as the base when every line is term", () => {
    const [g] = groupPolicies([row("s", "term", 100, "2030-01-01"), row("l", "term", 900, "2040-01-01")]);
    expect(g.base.id).toBe("l");
  });
  it("does not merge the same number across different owners", () => {
    expect(groupPolicies([{ ...row("a", "term", 1), contact_id: "c1" }, { ...row("b", "term", 1), contact_id: "c2" }])).toHaveLength(2);
  });
});
