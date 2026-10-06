import { describe, expect, it } from "vitest";
import { buildAlignmentCards, computeDeltas, dataCompleteness, overallAlignment, quarterLabel, reviewMode, type ReviewFacts } from "../../supabase/functions/_shared/quarterly-review-cards";

const good = (): ReviewFacts => ({
  charter: { source: "household", ratified: true, hasVision: true },
  investments: { accountCount: 3, total: 250000, trackedCount: 3, negativeCount: 0, staleCount: 0, statementsFiled: true },
  storehouses: { count: 4, aligned: 4, pending: 0, misaligned: 0, underfunded: 0, missingLanes: [] },
  insurance: { policyCount: 2, coverageTotal: 1000000, missingCoverageCount: 0, missingBeneficiaryCount: 0, renewalsDueSoon: 0, documentsFiled: true },
  estate: { will: "current", poa: "current", beneficiaries: "coordinated", documentsFiled: true },
  tax: { documentsFiled: true },
  liabilities: { personal: 0, corporate: 0, overdueLoans: 0 },
  documents: { percent: 100, satisfied: 5, total: 5, missing: [] },
});
const status = (f: ReviewFacts, key: string) => buildAlignmentCards(f).find((c) => c.key === key)!.status;

describe("buildAlignmentCards", () => {
  it("is all Aligned when everything is in place", () => {
    const cards = buildAlignmentCards(good());
    expect(cards.map((c) => c.status).every((s) => s === "Aligned")).toBe(true);
    expect(overallAlignment(cards).status).toBe("Aligned");
  });
  it("charter: missing = Needs Attention, unratified = Partial", () => {
    expect(status({ ...good(), charter: { source: null, ratified: false, hasVision: false } }, "charter")).toBe("Needs Attention");
    expect(status({ ...good(), charter: { source: "household", ratified: false, hasVision: true } }, "charter")).toBe("Partial");
  });
  it("investments: no tracking = Needs Attention; stale or negative = Partial", () => {
    const f = good();
    expect(status({ ...f, investments: { ...f.investments, trackedCount: 0 } }, "investments")).toBe("Needs Attention");
    expect(status({ ...f, investments: { ...f.investments, accountCount: 0, trackedCount: 0, total: 0 } }, "investments")).toBe("Not Assessed");
    expect(status({ ...f, investments: { ...f.investments, staleCount: 1 } }, "investments")).toBe("Partial");
    expect(status({ ...f, investments: { ...f.investments, negativeCount: 1 } }, "investments")).toBe("Partial");
    expect(status({ ...f, investments: { ...f.investments, statementsFiled: false } }, "investments")).toBe("Partial");
  });
  it("storehouse: underfunded/misaligned = Needs Attention, pending or missing lane = Partial", () => {
    const f = good();
    expect(status({ ...f, storehouses: { ...f.storehouses, underfunded: 1 } }, "storehouse")).toBe("Needs Attention");
    expect(status({ ...f, storehouses: { ...f.storehouses, pending: 1 } }, "storehouse")).toBe("Partial");
    expect(status({ ...f, storehouses: { ...f.storehouses, count: 3, missingLanes: [4] } }, "storehouse")).toBe("Partial");
    expect(status({ ...f, storehouses: { ...f.storehouses, count: 0 } }, "storehouse")).toBe("Needs Attention");
  });
  it("insurance: none = Not Assessed; missing beneficiary = Partial", () => {
    const f = good();
    expect(status({ ...f, insurance: { ...f.insurance, policyCount: 0 } }, "insurance")).toBe("Not Assessed");
    expect(status({ ...f, insurance: { ...f.insurance, missingBeneficiaryCount: 1 } }, "insurance")).toBe("Partial");
  });
  it("estate: unreviewed = Not Assessed; missing will = Needs Attention; outdated = Partial", () => {
    const f = good();
    expect(status({ ...f, estate: { will: null, poa: null, beneficiaries: null, documentsFiled: false } }, "estate")).toBe("Not Assessed");
    expect(status({ ...f, estate: { ...f.estate, will: "missing" } }, "estate")).toBe("Needs Attention");
    expect(status({ ...f, estate: { ...f.estate, will: "outdated" } }, "estate")).toBe("Partial");
  });
  it("tax, liabilities and documents", () => {
    const f = good();
    expect(status({ ...f, tax: { documentsFiled: false } }, "tax")).toBe("Needs Attention");
    expect(status({ ...f, tax: { documentsFiled: null } }, "tax")).toBe("Not Assessed");
    expect(status({ ...f, liabilities: { personal: 1000, corporate: 0, overdueLoans: 1 } }, "liabilities")).toBe("Needs Attention");
    expect(status({ ...f, documents: { percent: 40, satisfied: 2, total: 5, missing: ["Tax"] } }, "documents")).toBe("Partial");
    expect(status({ ...f, documents: { percent: 0, satisfied: 0, total: 5, missing: [] } }, "documents")).toBe("Needs Attention");
  });
  it("adds a corporate card only for corporate households", () => {
    expect(buildAlignmentCards(good()).some((c) => c.key === "corporate")).toBe(false);
    const cards = buildAlignmentCards({ ...good(), corporate: { activeAssetRatio: 0.6, usaOnFile: false, usaStale: null, sbdClawback: 12000 } });
    expect(cards.find((c) => c.key === "corporate")?.status).toBe("Needs Attention");
  });
  it("never puts a raw dollar figure into a status it did not compute", () => {
    const d = buildAlignmentCards(good()).find((c) => c.key === "investments")!.detail;
    expect(d).toContain("$250,000");
  });
});

describe("quarterLabel / computeDeltas / overallAlignment", () => {
  it("labels calendar quarters", () => {
    expect(quarterLabel(new Date("2026-10-06T12:00:00Z"))).toBe("2026 Q4");
    expect(quarterLabel(new Date("2026-03-31T12:00:00Z"))).toBe("2026 Q1");
  });
  it("computes changes against the previous review", () => {
    expect(computeDeltas({ aum: 110, net_worth: 90 }, { aum: 100, net_worth: 95, label: "2026 Q3" })).toEqual({ aum: 10, netWorth: -5, previousLabel: "2026 Q3" });
    expect(computeDeltas({ aum: 1, net_worth: 1 }, null)).toEqual({ aum: null, netWorth: null, previousLabel: null });
  });
  it("rolls cards up", () => {
    const cards = buildAlignmentCards({ ...good(), charter: { source: null, ratified: false, hasVision: false } });
    expect(overallAlignment(cards)).toMatchObject({ status: "Needs Attention", attention: 1 });
  });
});

describe("reviewMode / dataCompleteness", () => {
  it("ratified Charter = quarterly review; anything else = survey", () => {
    expect(reviewMode({ source: "household", ratified: true })).toBe("quarterly");
    expect(reviewMode({ source: "contact", ratified: true })).toBe("quarterly");
    expect(reviewMode({ source: "household", ratified: false })).toBe("survey");
    expect(reviewMode({ source: null, ratified: false })).toBe("survey");
  });
  it("reports which areas have no records on file", () => {
    expect(dataCompleteness(good())).toEqual({ total: 6, onFile: 6, missing: [] });
    const thin: ReviewFacts = {
      ...good(),
      investments: { accountCount: 0, total: 0, trackedCount: 0, negativeCount: 0, staleCount: 0, statementsFiled: null },
      storehouses: { count: 0, aligned: 0, pending: 0, misaligned: 0, underfunded: 0, missingLanes: [1, 2, 3, 4] },
      insurance: { policyCount: 0, coverageTotal: 0, missingCoverageCount: 0, missingBeneficiaryCount: 0, renewalsDueSoon: 0, documentsFiled: null },
      estate: { will: null, poa: null, beneficiaries: null, documentsFiled: null },
      documents: { percent: 0, satisfied: 0, total: 0, missing: [] },
      tax: { documentsFiled: null },
    };
    const c = dataCompleteness(thin);
    expect(c.onFile).toBe(1); // harvest tracking is vacuously fine with no accounts
    expect(c.missing).toContain("Investment accounts");
    expect(c.missing).toContain("Storehouse reserves");
  });
});
