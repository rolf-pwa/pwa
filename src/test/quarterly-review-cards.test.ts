import { describe, expect, it } from "vitest";
import { buildAlignmentCards, computeDeltas, dataCompleteness, estateSummary, overallAlignment, quarterLabel, reviewMode, type ReviewFacts } from "../../supabase/functions/_shared/quarterly-review-cards";
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
  liabilities: { total: 909_000, corporate: 0, overdueLoans: 0, revolving: { limit: 956_100, available: 47_100 } },
  targets: [target({})],
});
const card = (f: ReviewFacts, key: string) => buildAlignmentCards(f).find((c) => c.key === key)!;

describe("framework cards", () => {
  it("are the Vineyard / Storehouse framework, with no Tax or Document Readiness card", () => {
    expect(buildAlignmentCards(good()).map((c) => c.key)).toEqual(["charter", "vineyard", "liquidity", "strategic", "philanthropic", "legacy", "liabilities"]);
  });
  it("read the same figures as the balance sheet", () => {
    const f = good();
    expect(card(f, "vineyard").detail).toContain("$739,573");
    expect(card(f, "liquidity").detail).toContain("$171,024");
    expect(card(f, "liquidity").detail).toContain("$170,691 of income funds");
    expect(card(f, "strategic").detail).toContain("$61,408");
    expect(card(f, "legacy").detail).toContain("$1,537,500");
    expect(card(f, "legacy").detail).not.toMatch(/missing lane/i);
  });
  it("is all Aligned when everything is in place and every target is met", () => {
    const cards = buildAlignmentCards(good());
    expect(cards.every((c) => c.status === "Aligned")).toBe(true);
    expect(overallAlignment(cards).status).toBe("Aligned");
  });
  it("a Charter target that is short makes the area Needs Attention and carries the check", () => {
    const f = { ...good(), targets: [target({ value: 250_000 })] };
    const c = card(f, "liquidity");
    expect(c.status).toBe("Needs Attention");
    expect(c.targets?.[0].summary).toMatch(/short of the target/);
  });
  it("a target over its maximum flags the area (liabilities as % of assets)", () => {
    const f = { ...good(), targets: [target({ area: "liabilities", metric: "percent_of_total_assets", comparison: "at_most", value: 30 })] };
    expect(card(f, "liabilities").status).toBe("Needs Attention");
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
