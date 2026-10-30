import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { DEFAULT_CONFIG, evaluateHousehold, summarizeBook, type HouseholdSnapshot } from "../../supabase/functions/_shared/opportunity-rules";

const TODAY = "2026-10-30";

// A complete, healthy household: nothing should fire, nothing should be missing.
const base = (o: Partial<HouseholdSnapshot> = {}): HouseholdSnapshot => ({
  householdId: "h1", label: "Rivers-Hale",
  members: [
    { id: "a", name: "Jordan Rivers-Hale", role: "head_of_family", isMinor: false },
    { id: "b", name: "Sam Rivers-Hale", role: "spouse", isMinor: false },
  ],
  groupedAum: 400_000, totalAum: 400_000, tier: "tier_2b", hasRatifiedCharter: true,
  accounts: [{ id: "x1", name: "RRSP", type: "RRSP", value: 400_000, custodian: "iA Financial Group", beneficiary: "Sam", owner: "Jordan Rivers-Hale" }],
  policies: [
    { id: "p1", type: "term", coverage: 1_000_000, cashValue: 0, renewalDate: null, insuredContactId: "a", corporate: false },
    { id: "p2", type: "disability", coverage: 4_000, cashValue: 0, renewalDate: null, insuredContactId: "a", corporate: false },
  ],
  lifeCoverage: 1_000_000,
  needs: [
    { contactId: "a", need: 900_000, available: 1_000_000, shortfall: 0, createdAt: "2026-06-01T00:00:00Z" },
    { contactId: "b", need: 500_000, available: 1_000_000, shortfall: 0, createdAt: "2026-06-01T00:00:00Z" },
  ],
  debts: [], corporations: [], corporatePassiveIncome: null, sbdClawback: null,
  holdingTank: 0, liquidityReserve: 10_000, liquidityTarget: 10_000,
  professionals: { lawyer: true, executor: true, poa: true },
  ...o,
});

const types = (s: HouseholdSnapshot) => evaluateHousehold(s, TODAY).findings.map((f) => f.type);
const find = (s: HouseholdSnapshot, type: string) => evaluateHousehold(s, TODAY).findings.filter((f) => f.type === type);

describe("a complete household", () => {
  it("raises nothing and is fully complete", () => {
    const e = evaluateHousehold(base(), TODAY);
    expect(e.findings).toEqual([]);
    expect(e.gaps).toEqual([]);
    expect(e.completeness).toBe(1);
  });
});

describe("insurance coverage gap", () => {
  it("fires on a needs-analysis shortfall with the evidence and high confidence", () => {
    const s = base({ needs: [{ contactId: "a", need: 2_000_000, available: 1_000_000, shortfall: 1_000_000, createdAt: "2026-06-01T00:00:00Z" }, base().needs[1]] });
    const [f] = find(s, "insurance_coverage_gap");
    expect(f.key).toBe("shortfall:a");
    expect(f.confidence).toBe("high");
    expect(f.evidence.map((e) => e.label)).toContain("Shortfall");
  });
  it("drops to medium confidence when the analysis is over two years old", () => {
    const s = base({ needs: [{ contactId: "a", need: 2_000_000, available: 1_000_000, shortfall: 1_000_000, createdAt: "2023-01-01T00:00:00Z" }, base().needs[1]] });
    expect(find(s, "insurance_coverage_gap")[0].confidence).toBe("medium");
  });
  it("uses only the newest analysis for a person", () => {
    const s = base({ needs: [
      { contactId: "a", need: 2_000_000, available: 1_000_000, shortfall: 1_000_000, createdAt: "2025-01-01T00:00:00Z" },
      { contactId: "a", need: 900_000, available: 1_000_000, shortfall: 0, createdAt: "2026-06-01T00:00:00Z" },
      base().needs[1],
    ] });
    expect(find(s, "insurance_coverage_gap")).toEqual([]);
  });
  it("flags no life cover when there are dependants and no analysis, and reports the missing analysis as a gap", () => {
    const s = base({
      policies: [], lifeCoverage: 0, needs: [],
      members: [...base().members, { id: "c", name: "Casey Rivers-Hale", role: "minor", isMinor: true }],
    });
    const e = evaluateHousehold(s, TODAY);
    expect(e.findings.find((f) => f.key === "no-life-cover")?.confidence).toBe("medium");
    expect(e.gaps.filter((g) => g.field.startsWith("Needs analysis")).length).toBe(2);
  });
  it("does not flag no cover for a household with no dependants and no debt", () => {
    const s = base({ policies: [], lifeCoverage: 0, needs: [] });
    expect(find(s, "insurance_coverage_gap").filter((f) => f.key === "no-life-cover")).toEqual([]);
  });
  it("flags missing disability / critical illness at low confidence only when there is some insurance relationship", () => {
    const withoutDisability = base({ policies: [base().policies[0]] });
    expect(find(withoutDisability, "insurance_coverage_gap").find((f) => f.key === "no-disability-ci")?.confidence).toBe("low");
    const nothingAtAll = base({ policies: [], lifeCoverage: 0, needs: [] });
    expect(find(nothingAtAll, "insurance_coverage_gap").find((f) => f.key === "no-disability-ci")).toBeUndefined();
  });
});

describe("debt protection", () => {
  it("fires when the mortgage exceeds the life cover on file, by totals", () => {
    const s = base({ debts: [{ id: "d1", type: "mortgage", balance: 1_400_000, corporate: false }] });
    const [f] = find(s, "debt_protection");
    expect(f.confidence).toBe("medium");
    expect(f.title).toContain("$1,400,000");
  });
  it("ignores small debts, covered debts, corporate debts and non-mortgage debt", () => {
    expect(types(base({ debts: [{ id: "d", type: "mortgage", balance: 10_000, corporate: false }] }))).not.toContain("debt_protection");
    expect(types(base({ debts: [{ id: "d", type: "mortgage", balance: 800_000, corporate: false }] }))).not.toContain("debt_protection");
    expect(types(base({ debts: [{ id: "d", type: "mortgage", balance: 5_000_000, corporate: true }] }))).not.toContain("debt_protection");
    expect(types(base({ debts: [{ id: "d", type: "line_of_credit", balance: 5_000_000, corporate: false }] }))).not.toContain("debt_protection");
  });
});

describe("charter candidate and tier upgrade", () => {
  it("flags a household over the floor with no ratified charter", () => {
    expect(types(base({ hasRatifiedCharter: false, tier: "tier_2a" }))).toContain("charter_candidate");
  });
  it("does not flag one with a charter, or below the floor", () => {
    expect(types(base())).not.toContain("charter_candidate");
    expect(types(base({ hasRatifiedCharter: false, groupedAum: 100_000, totalAum: 100_000 }))).not.toContain("charter_candidate");
  });
  it("flags a household within the margin of the next threshold", () => {
    const s = base({ groupedAum: 700_000, totalAum: 700_000 });
    const [f] = find(s, "tier_upgrade");
    expect(f.key).toBe("to-750000");
    expect(f.title).toContain("$50,000 short");
  });
  it("does not flag one well below the threshold, or one above the top", () => {
    expect(types(base({ groupedAum: 400_000 }))).not.toContain("tier_upgrade");
    expect(types(base({ groupedAum: 3_000_000, totalAum: 3_000_000 }))).not.toContain("tier_upgrade");
  });
  it("reports missing AUM as a gap that blocks three rules", () => {
    const g = evaluateHousehold(base({ groupedAum: 0, totalAum: 0 }), TODAY).gaps.find((x) => x.field === "Assets under management")!;
    expect(g.blocks).toEqual(["charter_candidate", "tier_upgrade", "idle_cash"]);
  });
});

describe("consolidation", () => {
  const outside = { id: "x2", name: "RRSP at the bank", type: "RRSP", value: 120_000, custodian: "Big Bank", beneficiary: "Sam", owner: "Sam Rivers-Hale" };
  it("flags value held outside management", () => {
    const [f] = find(base({ accounts: [...base().accounts, outside] }), "consolidation");
    expect(f.title).toContain("$120,000");
    expect(f.evidence).toHaveLength(1);
  });
  it("ignores small outside balances and managed custodians", () => {
    expect(types(base({ accounts: [...base().accounts, { ...outside, value: 5_000 }] }))).not.toContain("consolidation");
    expect(types(base({ accounts: [...base().accounts, { ...outside, custodian: "JustWealth" }] }))).not.toContain("consolidation");
  });
  it("reports accounts with no custodian as a gap rather than assuming they are managed", () => {
    const e = evaluateHousehold(base({ accounts: [{ ...outside, custodian: null }] }), TODAY);
    expect(e.gaps.some((g) => g.field === "Account custodian")).toBe(true);
    expect(e.findings.some((f) => f.type === "consolidation")).toBe(false);
  });
});

describe("corporate structuring", () => {
  const corp = [{ id: "c1", name: "Example Holdings Ltd", totalAssets: 900_000 }];
  it("flags passive income close to or over the $50,000 line", () => {
    const near = find(base({ corporations: corp, corporatePassiveIncome: 45_000, sbdClawback: 0 }), "corporate_structuring")[0];
    expect(near.title).toContain("close to");
    const over = find(base({ corporations: corp, corporatePassiveIncome: 70_000, sbdClawback: 100_000 }), "corporate_structuring")[0];
    expect(over.title).toContain("over");
    expect(over.evidence.some((e) => e.value === "$100,000")).toBe(true);
  });
  it("stays quiet below the watch level and for households with no corporation", () => {
    expect(types(base({ corporations: corp, corporatePassiveIncome: 10_000, sbdClawback: 0 }))).not.toContain("corporate_structuring");
    expect(evaluateHousehold(base(), TODAY).gaps.some((g) => g.field === "Corporate passive income")).toBe(false);
  });
  it("reports unrecorded passive income as a gap", () => {
    const e = evaluateHousehold(base({ corporations: corp, corporatePassiveIncome: null }), TODAY);
    expect(e.gaps.find((g) => g.field === "Corporate passive income")?.blocks).toEqual(["corporate_structuring"]);
  });
});

describe("estate gaps", () => {
  it("flags registered accounts with no beneficiary, but not non-registered ones", () => {
    const s = base({ accounts: [
      { id: "r", name: "TFSA", type: "TFSA", value: 50_000, custodian: "iA Financial Group", beneficiary: null, owner: "Jordan Rivers-Hale" },
      { id: "n", name: "Non-registered", type: "Non-registered", value: 50_000, custodian: "iA Financial Group", beneficiary: null, owner: "Jordan Rivers-Hale" },
    ] });
    const [f] = find(s, "estate_gap").filter((x) => x.key === "beneficiaries");
    expect(f.evidence).toHaveLength(1);
    expect(f.evidence[0].label).toContain("TFSA");
  });
  it("treats a blank beneficiary as missing", () => {
    const s = base({ accounts: [{ ...base().accounts[0], beneficiary: "   " }] });
    expect(find(s, "estate_gap").some((f) => f.key === "beneficiaries")).toBe(true);
  });
  it("flags missing lawyer, executor and power of attorney at low confidence", () => {
    const [f] = find(base({ professionals: { lawyer: false, executor: true, poa: false } }), "estate_gap");
    expect(f.key).toBe("professionals");
    expect(f.confidence).toBe("low");
    expect(f.title).toContain("a lawyer");
    expect(f.title).toContain("a power of attorney");
    expect(f.title).not.toContain("executor");
  });
});

describe("idle cash and policy events", () => {
  it("flags a holding tank above the floor", () => {
    expect(find(base({ holdingTank: 60_000 }), "idle_cash")[0].key).toBe("holding-tank");
    expect(types(base({ holdingTank: 5_000 }))).not.toContain("idle_cash");
  });
  it("flags a liquidity reserve well over its target, and reports a missing target as a gap", () => {
    expect(find(base({ liquidityReserve: 80_000, liquidityTarget: 20_000 }), "idle_cash")[0].key).toBe("liquidity-surplus");
    const gap = evaluateHousehold(base({ liquidityReserve: 80_000, liquidityTarget: 0 }), TODAY).gaps;
    expect(gap.some((g) => g.field === "Liquidity reserve target")).toBe(true);
  });
  it("flags a renewal inside the window, not outside it or in the past", () => {
    const withRenewal = (d: string) => base({ policies: [{ ...base().policies[0], renewalDate: d }, base().policies[1]] });
    expect(find(withRenewal("2026-12-15"), "policy_event")[0].title).toContain("46 days");
    expect(types(withRenewal("2027-06-01"))).not.toContain("policy_event");
    expect(types(withRenewal("2026-09-01"))).not.toContain("policy_event");
  });
});

describe("evaluation as a whole", () => {
  it("orders findings with the surest first and gives every finding a key and a next step", () => {
    const e = evaluateHousehold(base({ hasRatifiedCharter: false, professionals: { lawyer: false, executor: false, poa: false }, holdingTank: 90_000 }), TODAY);
    const order = e.findings.map((f) => f.confidence);
    expect([...order].sort((a, b) => ({ high: 0, medium: 1, low: 2 })[a] - ({ high: 0, medium: 1, low: 2 })[b])).toEqual(order);
    for (const f of e.findings) {
      expect(f.key.length).toBeGreaterThan(0);
      expect(f.nextStep.length).toBeGreaterThan(0);
      expect(f.estValue).toBeNull();
    }
  });
  it("gives distinct dedupe keys within a household for repeat findings of one type", () => {
    const s = base({ needs: [
      { contactId: "a", need: 2_000_000, available: 0, shortfall: 2_000_000, createdAt: "2026-06-01T00:00:00Z" },
      { contactId: "b", need: 2_000_000, available: 0, shortfall: 2_000_000, createdAt: "2026-06-01T00:00:00Z" },
    ] });
    const keys = find(s, "insurance_coverage_gap").map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
  it("scores completeness as the share of needed inputs on file", () => {
    const e = evaluateHousehold(base({ groupedAum: 0, totalAum: 0, accounts: [], professionals: { lawyer: false, executor: false, poa: false } }), TODAY);
    expect(e.completeness).toBeGreaterThan(0);
    expect(e.completeness).toBeLessThan(1);
    expect(e.inputsPresent / e.inputsTotal).toBeCloseTo(e.completeness);
  });
  it("uses configurable thresholds", () => {
    const s = base({ holdingTank: 10_000 });
    expect(types(s)).not.toContain("idle_cash");
    expect(evaluateHousehold(s, TODAY, { ...DEFAULT_CONFIG, idleCashFloor: 5_000 }).findings.some((f) => f.type === "idle_cash")).toBe(true);
  });
});

describe("book summary", () => {
  it("counts findings by type and confidence, and ranks gaps by how many households miss them", () => {
    const e1 = evaluateHousehold(base({ householdId: "h1", hasRatifiedCharter: false, groupedAum: 0, totalAum: 0 }), TODAY);
    const e2 = evaluateHousehold(base({ householdId: "h2", groupedAum: 0, totalAum: 0, holdingTank: 90_000 }), TODAY);
    const e3 = evaluateHousehold(base({ householdId: "h3" }), TODAY);
    const sum = summarizeBook([{ householdId: "h1", evaluation: e1 }, { householdId: "h2", evaluation: e2 }, { householdId: "h3", evaluation: e3 }]);
    expect(sum.households).toBe(3);
    expect(sum.findingsByType.idle_cash).toBe(1);
    expect(sum.topGaps[0]).toEqual({ field: "Assets under management", households: 2 });
    expect(sum.averageCompleteness).toBeLessThan(1);
  });
  it("groups per-person gaps under one kind, counting a household once", () => {
    const e = evaluateHousehold(base({ needs: [] }), TODAY);
    const sum = summarizeBook([{ householdId: "h1", evaluation: e }]);
    expect(sum.topGaps.find((g) => g.field === "Needs analysis")).toEqual({ field: "Needs analysis", households: 1 });
  });
  it("handles an empty book", () => {
    expect(summarizeBook([]).averageCompleteness).toBe(1);
  });
});

describe("wiring", () => {
  const read = (p: string) => readFileSync(p, "utf8");
  it("the report function is staff only and reads only", () => {
    const src = read("supabase/functions/book-of-business-report/index.ts");
    expect(src).toContain("requireStaff");
    expect(src).toContain("@prosperwise.ca");
    expect(src).not.toMatch(/\.(insert|update|upsert|delete)\(/);
  });
  it("the snapshot gatherer reads only", () => {
    expect(read("supabase/functions/_shared/opportunity-snapshot.ts")).not.toMatch(/\.(insert|update|upsert|delete)\(/);
  });
  it("the rules module has no database or network access", () => {
    const src = read("supabase/functions/_shared/opportunity-rules.ts");
    expect(src).not.toMatch(/^import /m);
    expect(src).not.toMatch(/fetch\(|\.from\(/);
  });
});
