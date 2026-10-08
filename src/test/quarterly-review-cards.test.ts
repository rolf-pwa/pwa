import { describe, expect, it } from "vitest";
import { buildAlignmentCards, computeDeltas, dataCompleteness, estateSummary, overallAlignment, planRebalance, quarterLabel, reviewMode, type ReviewFacts } from "../../supabase/functions/_shared/quarterly-review-cards";
import { evaluateTarget, type BalanceFigures, type CharterTarget } from "../../supabase/functions/_shared/charter-targets";

const figures: BalanceFigures = {
  areas: { vineyard: 739_573, liquidity: 171_024, strategic: 61_408, philanthropic: 0, legacy: 1_537_500, liabilities: 909_000 },
  totalAssets: 2_519_505, investableAssets: 982_005, netWorth: 1_610_505, monthlySpending: null,
};
const target = (o: Partial<CharterTarget>) => evaluateTarget({ area: "liquidity", label: "Liquidity Reserve", metric: "amount", comparison: "at_least", value: 150_000, value_max: null, quote: "q", ...o }, figures);

const good = (): ReviewFacts => ({
  charter: { source: "vault", ratified: true, hasVision: true },
  balance: { vineyard: 739_573, holdingTank: 10_000, liquidity: 171_024, strategic: 61_408, philanthropic: 5_000, legacy: 1_537_500, totalAssets: 2_519_505, liabilities: 909_000, netWorth: 1_610_505, realEstate: 1_537_500, cashValue: 61_408, incomeFundsInLiquidity: 170_691 },
  vineyard: { accountCount: 2, statementsRead: 2, staleCount: 0, statementsFiled: true, withdrawalsYtd: 96_162 },
  liquidity: { setUp: false, target: null },
  strategic: { policyCount: 1, coverageTotal: 300_000, missingCoverageCount: 0, missingBeneficiaryCount: 0, renewalsDueSoon: 0, documentsFiled: true },
  legacy: { realEstate: 1_537_500, estate: { source: "documents", adults: [{ name: "Colleen", will: "signed", willDate: "2023-01-17", poa: "on_file" }], trusts: 0 } },
  liabilities: { total: 909_000, corporate: 0, overdueLoans: 0, revolving: { limit: 956_100, available: 47_100 }, rated: { interest: 16_102, unratedCount: 0, unratedBalance: 0 } },
  targets: [target({})],
});
// Everything on target: the Liquidity Reserve holds exactly its Charter target.
const onTarget = (): ReviewFacts => ({ ...good(), balance: { ...good().balance, liquidity: 150_000 }, targets: [target({})].map((t) => ({ ...t, actual: 150_000, gapAmount: 0 })) });
const card = (f: ReviewFacts, key: string) => buildAlignmentCards(f).find((c) => c.key === key)!;

describe("framework cards", () => {
  it("are the Vineyard / Storehouse framework, with no Tax or Document Readiness card", () => {
    expect(buildAlignmentCards(good()).map((c) => c.key)).toEqual(["charter", "vineyard", "liquidity", "strategic", "philanthropic", "legacy", "liabilities"]);
  });
  it("read the same figures as the balance sheet", () => {
    const f = good();
    expect(card(f, "vineyard").detail).toContain("$739,573");
    expect(card(f, "liquidity").detail).toContain("$171,024");
    expect(card(f, "liquidity").detail).toContain("$170,691 is income funds");
    expect(card(f, "strategic").detail).toContain("$61,408");
    expect(card(f, "legacy").detail).toContain("$1,537,500");
    expect(card(f, "legacy").detail).not.toMatch(/missing lane/i);
  });
  it("is all Aligned when everything is in place and every target is met", () => {
    const cards = buildAlignmentCards(onTarget());
    expect(cards.every((c) => c.status === "Aligned")).toBe(true);
    expect(overallAlignment(cards).status).toBe("Aligned");
  });
  it("a Charter target that is short makes the area Needs Attention and carries the check", () => {
    const f = { ...good(), targets: [target({ value: 250_000 })] };
    const c = card(f, "liquidity");
    expect(c.status).toBe("Needs Attention");
    expect(c.targets?.[0].summary).toMatch(/short of the target/);
    expect(c.actions.join(" ")).toMatch(/Move \$78,976 from the Vineyard to top up the Liquidity Reserve/);
  });
  it("a target over its maximum flags the area (liabilities as % of assets)", () => {
    const f = { ...good(), targets: [target({ area: "liabilities", metric: "percent_of_total_assets", comparison: "at_most", value: 30 })] };
    expect(card(f, "liabilities").status).toBe("Needs Attention");
  });
  it("shows desired state, current state and action required on every card", () => {
    for (const c of buildAlignmentCards(good())) {
      expect(c.desired.length).toBeGreaterThan(0);
      expect(c.current.length).toBeGreaterThan(0);
      expect(c.actions.length).toBeGreaterThan(0);
    }
  });
  it("liquidity above its Charter target: desired $100,000, current $171,024, rebalance the excess to the Vineyard", () => {
    const cards = buildAlignmentCards(good());
    const liq = cards.find((c) => c.key === "liquidity")!;
    expect(liq.desired.join(" ")).toContain("$150,000"); // the fixture's target
    expect(liq.current.join(" ")).toContain("$171,024");
    expect(liq.current.join(" ")).toContain("$96,162 spent so far this year");
    expect(liq.actions).toEqual(["Rebalance $21,024 from the Liquidity Reserve to the Vineyard."]);
    expect(liq.status).toBe("Partial");
    expect(cards.find((c) => c.key === "vineyard")!.actions).toContain("Receive $21,024 from the Liquidity Reserve.");
  });
  it("liquidity without a Charter or Storehouse target is only Partial; with nothing set aside it needs attention", () => {
    expect(card({ ...good(), targets: [] }, "liquidity").status).toBe("Partial");
    expect(card({ ...good(), targets: [], balance: { ...good().balance, liquidity: 0, incomeFundsInLiquidity: 0 } }, "liquidity").status).toBe("Needs Attention");
    expect(card({ ...good(), targets: [], liquidity: { setUp: true, target: 300_000 } }, "liquidity").status).toBe("Needs Attention");
  });
  it("charter: missing = Needs Attention, unratified = Partial", () => {
    expect(card({ ...good(), charter: { source: null, ratified: false, hasVision: false } }, "charter").status).toBe("Needs Attention");
    expect(card({ ...good(), charter: { source: "household", ratified: false, hasVision: true } }, "charter").status).toBe("Partial");
  });
  it("vineyard: unread or stale accounts = Partial; nothing recorded = Not Assessed", () => {
    expect(card({ ...good(), vineyard: { ...good().vineyard, statementsRead: 1 } }, "vineyard").status).toBe("Partial");
    expect(card({ ...good(), vineyard: { ...good().vineyard, staleCount: 1 } }, "vineyard").status).toBe("Partial");
    expect(card({ ...good(), vineyard: { ...good().vineyard, accountCount: 0 }, balance: { ...good().balance, vineyard: 0 } }, "vineyard").status).toBe("Not Assessed");
  });
  it("strategic: missing beneficiary = Partial; nothing at all = Not Assessed", () => {
    expect(card({ ...good(), strategic: { ...good().strategic, missingBeneficiaryCount: 1 } }, "strategic").status).toBe("Partial");
    expect(card({ ...good(), strategic: { ...good().strategic, policyCount: 0 }, balance: { ...good().balance, strategic: 0, cashValue: 0 } }, "strategic").status).toBe("Not Assessed");
  });
  it("liabilities compare the Charter's yearly debt budget with the interest actually owed", () => {
    const budget = target({ area: "liabilities", label: "Debt service budget", metric: "annual_amount", value: 10_000 });
    const over = card({ ...good(), targets: [budget] }, "liabilities");
    expect(over.actions.join(" ")).toMatch(/exceeds the Charter's \$10,000 budget by \$6,102/);
    const unrated = card({ ...good(), targets: [budget], liabilities: { ...good().liabilities, rated: { interest: 16_102, unratedCount: 1, unratedBalance: 570_000 } } }, "liabilities");
    expect(unrated.actions.join(" ")).toMatch(/Record the interest rate on 1 liability \(\$570,000\)/);
  });
  it("legacy actions name the missing estate documents", () => {
    const f = { ...good(), legacy: { realEstate: 1_537_500, estate: { source: "documents" as const, adults: [{ name: "Colleen", will: "signed" as const, willDate: "2023-01-17", poa: "missing" as const }, { name: "Keith", will: "missing" as const, willDate: null, poa: "missing" as const }], trusts: 0 } } };
    expect(card(f, "legacy").actions).toEqual(["Locate or draft Colleen's Power of Attorney.", "Locate or draft Keith's Will.", "Locate or draft Keith's Power of Attorney."]);
  });
  it("philanthropic: empty with no Charter target is Not Assessed", () => {
    expect(card({ ...good(), balance: { ...good().balance, philanthropic: 0 }, targets: [] }, "philanthropic").status).toBe("Not Assessed");
  });
  it("adds a corporate card only for corporate households", () => {
    expect(buildAlignmentCards(good()).some((c) => c.key === "corporate")).toBe(false);
    const c = buildAlignmentCards({ ...good(), corporate: { activeAssetRatio: 0.6, usaOnFile: false, usaStale: null, sbdClawback: 12000 } }).find((x) => x.key === "corporate");
    expect(c?.status).toBe("Needs Attention");
  });
});

describe("estateSummary", () => {
  it("from approved documents: signed will + POA for every adult = Aligned", () => {
    const r = estateSummary(good().legacy.estate);
    expect(r.status).toBe("Aligned");
    expect(r.detail).toBe("Colleen: Will signed 2023-01-17; Power of Attorney on file.");
  });
  it("a missing or unsigned will = Needs Attention; a missing POA only = Partial", () => {
    expect(estateSummary({ source: "documents", adults: [{ name: "K", will: "missing", willDate: null, poa: "on_file" }], trusts: 0 }).status).toBe("Needs Attention");
    expect(estateSummary({ source: "documents", adults: [{ name: "K", will: "unsigned", willDate: null, poa: "on_file" }], trusts: 0 }).status).toBe("Needs Attention");
    expect(estateSummary({ source: "documents", adults: [{ name: "K", will: "signed", willDate: null, poa: "missing" }], trusts: 1 })).toMatchObject({ status: "Partial" });
  });
  it("falls back to hand-entered statuses, and to Not Assessed with nothing", () => {
    expect(estateSummary({ source: "manual", adults: [], trusts: 0, manual: { will: "current", poa: "current", beneficiaries: "coordinated" } }).status).toBe("Aligned");
    expect(estateSummary({ source: "manual", adults: [], trusts: 0, manual: { will: "missing", poa: null, beneficiaries: null } }).status).toBe("Needs Attention");
    expect(estateSummary({ source: "none", adults: [], trusts: 0 }).status).toBe("Not Assessed");
  });
});

describe("quarterLabel / computeDeltas / reviewMode / dataCompleteness", () => {
  it("labels calendar quarters", () => {
    expect(quarterLabel(new Date("2026-10-06T12:00:00Z"))).toBe("2026 Q4");
    expect(quarterLabel(new Date("2026-03-31T12:00:00Z"))).toBe("2026 Q1");
  });
  it("computes changes against the previous review", () => {
    expect(computeDeltas({ aum: 110, net_worth: 90 }, { aum: 100, net_worth: 95, label: "2026 Q3" })).toEqual({ aum: 10, netWorth: -5, previousLabel: "2026 Q3" });
    expect(computeDeltas({ aum: 1, net_worth: 1 }, null)).toEqual({ aum: null, netWorth: null, previousLabel: null });
  });
  it("ratified Charter = quarterly review; anything else = survey", () => {
    expect(reviewMode({ source: "vault", ratified: true })).toBe("quarterly");
    expect(reviewMode({ source: "household", ratified: false })).toBe("survey");
    expect(reviewMode({ source: null, ratified: false })).toBe("survey");
  });
  it("reports which areas have no records on file", () => {
    expect(dataCompleteness(good())).toEqual({ total: 4, onFile: 4, missing: [] });
    const thin: ReviewFacts = { ...good(), vineyard: { ...good().vineyard, accountCount: 0 }, balance: { ...good().balance, vineyard: 0 }, strategic: { ...good().strategic, policyCount: 0 }, legacy: { realEstate: 0, estate: { source: "none", adults: [], trusts: 0 } }, targets: [] };
    expect(dataCompleteness(thin).missing).toEqual(["Investment accounts", "Insurance policies", "Estate documents", "Charter targets"]);
    const withStatements = dataCompleteness({ ...good(), statementData: { accounts: 3, withIncomeFunds: 0, withWithdrawals: 0 } });
    expect(withStatements.missing).toEqual(["Income funds read from statements", "Withdrawals read from statements"]);
  });
});

describe("planRebalance", () => {
  const t = (area: "liquidity" | "strategic" | "philanthropic", value: number, balance: number) =>
    evaluateTarget({ area, label: `${area} target`, metric: "amount", comparison: "target", value, value_max: null, quote: "q" },
      { ...figures, areas: { ...figures.areas, [area]: balance } });
  const withTargets = (targets: ReturnType<typeof t>[], balances: Partial<ReviewFacts["balance"]> = {}): ReviewFacts => ({ ...good(), targets, balance: { ...good().balance, ...balances } });

  it("sends a reserve's excess to the Vineyard", () => {
    expect(planRebalance(withTargets([t("liquidity", 100_000, 171_024)], { liquidity: 171_024 }))).toEqual([{ from: "liquidity", to: "vineyard", amount: 71_024 }]);
  });
  it("tops a short reserve up from the Vineyard", () => {
    expect(planRebalance(withTargets([t("liquidity", 200_000, 150_000)], { liquidity: 150_000 }))).toEqual([{ from: "vineyard", to: "liquidity", amount: 50_000 }]);
  });
  it("uses one reserve's excess to fill another's shortfall before touching the Vineyard", () => {
    const moves = planRebalance(withTargets([t("liquidity", 100_000, 171_024), t("strategic", 90_000, 61_408)], { liquidity: 171_024, strategic: 61_408 }));
    expect(moves).toEqual([
      { from: "liquidity", to: "strategic", amount: 28_592 },
      { from: "liquidity", to: "vineyard", amount: 42_432 },
    ]);
  });
  it("does nothing within 10% of target, without targets, or for yearly figures and rules", () => {
    expect(planRebalance(withTargets([t("liquidity", 100_000, 105_000)], { liquidity: 105_000 }))).toEqual([]);
    expect(planRebalance(withTargets([]))).toEqual([]);
    const flow = evaluateTarget({ area: "vineyard", label: "Income", metric: "annual_amount", comparison: "target", value: 123_200, value_max: null, quote: "q" }, { ...figures, withdrawnYtd: 96_162 });
    expect(planRebalance(withTargets([flow]))).toEqual([]);
  });
});

describe("estateFactsFrom (shared by the Review and the Governance Audit)", () => {
  const people = [{ id: "c1", first_name: "Colleen", family_role: "head_of_family" }, { id: "c2", first_name: "Keith", family_role: "spouse" }, { id: "c3", first_name: "Kid", family_role: "child" }];
  it("reads each adult's signed Will and Power of Attorney from approved documents", async () => {
    const { estateFactsFrom } = await import("../../supabase/functions/_shared/quarterly-review-cards");
    const e = estateFactsFrom(people, [
      { contact_id: "c1", document_type: "will", signed: true, document_date: "2023-01-17" },
      { contact_id: "c2", document_type: "will", signed: false, document_date: null },
      { contact_id: "c2", document_type: "power_of_attorney", signed: true, document_date: null },
      { contact_id: null, document_type: "trust", signed: null, document_date: null },
    ], null);
    expect(e.source).toBe("documents");
    expect(e.adults).toEqual([
      { name: "Colleen", will: "signed", willDate: "2023-01-17", poa: "missing" },
      { name: "Keith", will: "unsigned", willDate: null, poa: "on_file" },
    ]);
    expect(e.trusts).toBe(1);
  });
  it("falls back to the hand-entered statuses, then to none", async () => {
    const { estateFactsFrom } = await import("../../supabase/functions/_shared/quarterly-review-cards");
    expect(estateFactsFrom(people, [], { will: "current", poa: null, beneficiaries: null }).source).toBe("manual");
    expect(estateFactsFrom(people, [], { will: null, poa: null, beneficiaries: null }).source).toBe("none");
    expect(estateFactsFrom([], [], null).adults).toEqual([]);
  });
});

describe("Strategic Reserve with assigned credit", () => {
  const noPolicies = { policyCount: 0, coverageTotal: 0, missingCoverageCount: 0, missingBeneficiaryCount: 0, renewalsDueSoon: 0, documentsFiled: null };
  it("says how much of the reserve is available credit and that it is offset in liabilities", () => {
    const f: ReviewFacts = { ...good(), balance: { ...good().balance, strategic: 230_000, cashValue: 0, creditCapacity: 180_000 }, strategic: noPolicies };
    const c = card(f, "strategic");
    expect(c.current.join(" ")).toContain("$230,000 in the reserve, of which $180,000 is available credit");
    expect(c.current.join(" ")).toContain("offset by an equal undrawn-credit line");
    expect(c.status).not.toBe("Not Assessed");
  });
  it("never sends credit on as money: a surplus can move only the real assets in the reserve", () => {
    const strategicTarget = evaluateTarget({ area: "strategic", label: "Strategic Reserve", metric: "amount", comparison: "at_least", value: 100_000, value_max: null, quote: "" }, { ...figures, areas: { ...figures.areas, strategic: 280_000 } });
    const f: ReviewFacts = { ...good(), balance: { ...good().balance, strategic: 280_000, creditCapacity: 180_000 }, targets: [strategicTarget] };
    const moved = planRebalance(f).filter((m) => m.from === "strategic").reduce((a, m) => a + m.amount, 0);
    expect(moved).toBeLessThanOrEqual(100_000);
  });
});
