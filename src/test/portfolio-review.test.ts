import { describe, it, expect } from "vitest";
import { classifyFund, classTotals, driftFor, buildPortfolioPack, type PackAccount } from "../../supabase/functions/_shared/portfolio-review";

const acct = (over: Partial<PackAccount> = {}): PackAccount => ({
  id: "a1", name: "iA RRSP", number: "123", type: "RRSP", custodian: "iA Financial Group", owner: "Sam", value: 100_000, boyValue: 90_000, asOf: "2026-09-30",
  returns: { ytd: 8, sixMonth: null, oneYear: 9, threeYear: null, fiveYear: null, sinceInception: null }, priorValue: 98_000, priorAsOf: "2026-08-31",
  statement: { statementDate: "2026-09-30", funds: [{ name: "A", category: "Income Funds", value: 40_000 }, { name: "B", category: "Canadian Equity funds", value: 30_000 }, { name: "C", category: "U.S. & International Equity Funds", value: 30_000 }] }, ...over,
});

describe("classifying funds by the statement's category", () => {
  it("reads the three categories seen on iA statements", () => {
    expect(classifyFund("Income Funds")).toBe("income");
    expect(classifyFund("Canadian Equity funds")).toBe("canadian_equity");
    expect(classifyFund("U.S. & International Equity Funds")).toBe("us_intl_equity");
  });
  it("falls back to the fund's name, and to not classified", () => {
    expect(classifyFund(null, "Money Market Fund")).toBe("income");
    expect(classifyFund("Balanced", "Mystery")).toBe("other");
    expect(classifyFund("Global Equity")).toBe("us_intl_equity");
  });
});

describe("drift against the Investor Profile", () => {
  const t = classTotals(acct().statement!.funds);
  it("is within the band, or says which way and how much to move", () => {
    expect(driftFor(t, { incomePct: 40, bandPct: 5 }).status).toBe("within");
    const d = driftFor(t, { incomePct: 30, bandPct: 5 });
    expect(d.status).toBe("too_much_income");
    expect(d.moveToIncome).toBe(-10_000);
    expect(driftFor(t, { incomePct: 50, bandPct: 5 }).status).toBe("too_little_income");
  });
  it("says so when there is no target or no data", () => {
    expect(driftFor(t, null).status).toBe("no_target");
    expect(driftFor(classTotals([]), { incomePct: 40, bandPct: 5 }).status).toBe("no_data");
  });
});

describe("the pack", () => {
  it("totals the household and flags what to raise", () => {
    const p = buildPortfolioPack({ accounts: [acct(), acct({ id: "a2", name: "iA TFSA", number: "456", value: 50_000, boyValue: 60_000, priorValue: 51_000, returns: { ytd: -16, sixMonth: null, oneYear: null, threeYear: null, fiveYear: null, sinceInception: null }, statement: null })], profiles: [{ accountNumber: null, label: "Balanced", incomePct: 30, equityPct: 70, bandPct: 5 }], today: "2026-10-14" });
    expect(p.totalValue).toBe(150_000);
    expect(p.household.coveragePct).toBe(66.7);
    expect(p.household.drift.status).toBe("too_much_income");
    expect(p.household.changeYtd).toBe(0);
    expect(p.exceptions.some((e) => /down 16\.0% year to date/.test(e.text))).toBe(true);
    expect(p.gaps.some((g) => /No fund detail for iA TFSA/.test(g))).toBe(true);
  });
  it("notes a missing profile and a stale statement", () => {
    const p = buildPortfolioPack({ accounts: [acct({ statement: { statementDate: "2026-03-31", funds: acct().statement!.funds } })], profiles: [], today: "2026-10-14" });
    expect(p.gaps).toContain("No Investor Profile on file. Add the target mix to compare against.");
    expect(p.exceptions.some((e) => /days old/.test(e.text))).toBe(true);
    expect(p.household.drift.status).toBe("no_target");
  });
  it("uses an account's own profile over the household's", () => {
    const p = buildPortfolioPack({ accounts: [acct()], profiles: [{ accountNumber: null, label: null, incomePct: 10, equityPct: 90, bandPct: 5 }, { accountNumber: "123", label: "Cautious", incomePct: 40, equityPct: 60, bandPct: 5 }], today: "2026-10-14" });
    expect(p.accounts[0].drift.status).toBe("within");
  });
});

import { resetCheck, isResetSeries, ageOn, HARD_LINE_TOLERANCE } from "../../supabase/functions/_shared/portfolio-review";

describe("iA's hard line", () => {
  const t = classTotals([{ name: "A", category: "Income Funds", value: 40_400 }, { name: "B", category: "Canadian Equity funds", value: 59_600 }]);
  it("treats anything that rounds to the target as on it, and flags the rest", () => {
    expect(HARD_LINE_TOLERANCE).toBe(0.5);
    expect(driftFor(t, { incomePct: 40, bandPct: 0 }).status).toBe("within");
    const tight = classTotals([{ name: "A", category: "Income Funds", value: 34_000 }, { name: "B", category: "Canadian Equity funds", value: 66_000 }]);
    expect(driftFor(tight, { incomePct: 40, bandPct: 0 }).status).toBe("too_little_income");
  });
});

describe("death benefit resets", () => {
  const g = (over: Record<string, unknown> = {}) => ({ series: "Series 75/100", maturityDate: "2046-12-31", guaranteedAtMaturity: 1, guaranteedAtDeath: 92_468, lastQuarterFee: 1, valueOfFunds: 100_067, ...over });
  const a = (over: Partial<PackAccount> = {}): PackAccount => ({ ...acct(), guarantee: g(), ownerDob: "1955-06-01", ...over });
  it("knows which series can be reset and ages by birthday", () => {
    expect(isResetSeries("Series 75/100")).toBe(true);
    expect(isResetSeries("Series 75 / 100 Prestige 500")).toBe(true);
    expect(isResetSeries("Series 75/75")).toBe(false);
    expect(ageOn("1955-12-31", "2026-10-14")).toBe(70);
    expect(ageOn("1955-10-14", "2026-10-14")).toBe(71);
  });
  it("lists the room on an eligible account, and totals it", () => {
    const r = resetCheck([a(), a({ id: "a2", value: 10_486, guarantee: g({ valueOfFunds: 10_486, guaranteedAtDeath: 9_711 }) })], "2026-10-14");
    expect(r.rows[0].status).toBe("reset");
    expect(r.rows[0].room).toBeCloseTo(7_532, 0);
    expect(r.toReset).toBe(2);
    expect(r.totalRoom).toBeCloseTo(7_532 + 775, 0);
  });
  it("skips 75/75, anyone 85 or over, no room, and asks for a date of birth when missing", () => {
    expect(resetCheck([a({ guarantee: g({ series: "Series 75/75" }) })], "2026-10-14").rows[0].status).toBe("no_reset_series");
    expect(resetCheck([a({ ownerDob: "1940-01-01" })], "2026-10-14").rows[0].status).toBe("too_old");
    expect(resetCheck([a({ value: 90_000, guarantee: g({ valueOfFunds: 100_067 }) })], "2026-10-14").rows[0].status).toBe("no_room");
    expect(resetCheck([a({ ownerDob: null })], "2026-10-14").rows[0].status).toBe("needs_dob");
    expect(resetCheck([a({ guarantee: null })], "2026-10-14").rows).toEqual([]);
  });
  it("flags the last chance in the year an owner turns 85", () => {
    const r = resetCheck([a({ ownerDob: "1941-12-01" })], "2026-10-14");
    expect(r.rows[0].lastChance).toBe(true);
    expect(r.rows[0].turns85On).toBe("2026-12-01");
  });
});

describe("zero balances", () => {
  it("are left out of the pack entirely", () => {
    const p = buildPortfolioPack({ accounts: [acct(), acct({ id: "z", name: "Empty", number: "999", value: 0, statement: null, guarantee: { series: "Series 75/100", maturityDate: null, guaranteedAtMaturity: 0, guaranteedAtDeath: 247, lastQuarterFee: 0, valueOfFunds: 0 } })], profiles: [], today: "2026-10-14" });
    expect(p.accounts.map((a) => a.id)).toEqual(["a1"]);
    expect(p.totalValue).toBe(100_000);
    expect(p.gaps.some((g) => /Empty/.test(g))).toBe(false);
    expect(p.resets.rows).toEqual([]);
  });
});

import { resolveProfile, type ModelPortfolio } from "../../supabase/functions/_shared/portfolio-review";

describe("iA model portfolios", () => {
  const balanced: ModelPortfolio = { asOf: "2026-05-31", key: "balanced", label: "Balanced", incomeMin: 35, incomeMax: 55, equityMin: 45, equityMax: 65, incomeTarget: 40, funds: [] };
  const growth: ModelPortfolio = { ...balanced, key: "growth", label: "Growth", incomeMin: 20, incomeMax: 40, incomeTarget: 25 };
  const funds = (income: number) => [{ name: "I", category: "Income Funds", value: income * 1000 }, { name: "E", category: "Canadian Equity funds", value: (100 - income) * 1000 }];
  const prof = { accountNumber: null, label: null, incomePct: 40, equityPct: 60, bandPct: 0, profileKey: "balanced" };

  it("takes the target and range from the model, not from what was typed", () => {
    const r = resolveProfile({ ...prof, incomePct: 99 }, [balanced])!;
    expect(r.incomePct).toBe(40);
    expect([r.rangeMin, r.rangeMax]).toEqual([35, 55]);
    expect(resolveProfile({ ...prof, profileKey: "custom" }, [balanced])!.rangeMin).toBeUndefined();
  });
  it("holds an account to the profile's income range", () => {
    const r = resolveProfile(prof, [balanced])!;
    expect(driftFor(classTotals(funds(41)), r).status).toBe("within");
    expect(driftFor(classTotals(funds(36)), r).status).toBe("within");
    expect(driftFor(classTotals(funds(34)), r).status).toBe("too_little_income");
    expect(driftFor(classTotals(funds(31)), r).status).toBe("too_little_income");
    expect(driftFor(classTotals(funds(60)), r).status).toBe("too_much_income");
    expect(driftFor(classTotals(funds(34)), r).moveToIncome).toBe(6000);
  });
  it("flags the same accounts iA labels as a different profile, and says why", () => {
    const p = buildPortfolioPack({ accounts: [acct({ number: "1", statement: { statementDate: "2026-09-30", funds: funds(34) } }), acct({ id: "a2", number: "2", statement: { statementDate: "2026-09-30", funds: funds(41) } })], profiles: [prof], today: "2026-10-14", models: [balanced, growth] });
    expect(p.accounts.map((a) => a.drift.status)).toEqual(["too_little_income", "within"]);
    expect(p.exceptions.some((e) => /outside the Balanced range \(35-55% income\)/.test(e.text))).toBe(true);
    expect(p.modelAsOf).toBe("2026-05-31");
  });
});

import { compareToModel, normalizeFundName } from "../../supabase/functions/_shared/portfolio-review";

describe("funds against the model, fund by fund", () => {
  const balanced: ModelPortfolio = { asOf: "2026-05-31", key: "balanced", label: "Balanced", incomeMin: 35, incomeMax: 55, equityMin: 45, equityMax: 65, incomeTarget: 40, funds: [
    { name: "Fixed income managed portfolio (iA)", weight: 40 }, { name: "Canadian Equity Growth (iA)", weight: 10 }, { name: "Fidelity Canadian Opportunities", weight: 10 }, { name: "Fidelity Insights", weight: 20 }, { name: "Fidelity Global Concentrated Equity", weight: 20 }] };
  it("matches statement names to the model's despite the series prefix", () => {
    expect(normalizeFundName("3603H-NSC-Fixed Income Managed Portfolio (iA)")).toBe(normalizeFundName("Fixed income managed portfolio (iA)"));
    expect(normalizeFundName("3233B-DSC-Thematic Innovation (iA)")).toBe("thematicinnovationia");
  });
  it("shows an account that holds the model's funds at different weights", () => {
    const c = compareToModel([
      { name: "3603H-NSC-Fixed Income Managed Portfolio (iA)", category: "Income Funds", value: 49_072 }, { name: "3790H-NSC-Fidelity Canadian Opportunities", category: "Canadian Equity funds", value: 27_547 },
      { name: "3106H-NSC-Fidelity Insights", category: "U.S. & International Equity Funds", value: 24_447 }, { name: "3008H-NSC-Fidelity Global Concentrated Equity", category: "U.S. & International Equity Funds", value: 23_133 }, { name: "3725H-NSC-Canadian Equity Growth (iA)", category: "Canadian Equity funds", value: 22_001 },
    ], balanced)!;
    expect(c.offModelPct).toBe(0);
    expect(c.rows.find((r) => r.name.startsWith("Fidelity Canadian"))!.diffPts).toBeGreaterThan(8);
    expect(c.activeSharePct).toBeGreaterThan(8);
    expect(c.moveValue).toBeGreaterThan(10_000);
  });
  it("flags funds the model does not hold, and model funds not held", () => {
    const c = compareToModel([
      { name: "3603H-NSC-Fixed Income Managed Portfolio (iA)", category: "Income Funds", value: 41_038 }, { name: "3233H-NSC-Thematic Innovation (iA)", category: "U.S. & International Equity Funds", value: 13_325 },
      { name: "3695H-NSC-Dividend Growth (iA)", category: "Canadian Equity funds", value: 12_198 }, { name: "3019H-NSC-Global Opportunities (Loomis Sayles)", category: "U.S. & International Equity Funds", value: 11_633 },
      { name: "3790H-NSC-Fidelity Canadian Opportunities", category: "Canadian Equity funds", value: 10_339 },
    ], balanced)!;
    const off = c.rows.filter((r) => !r.inModel).map((r) => r.name);
    expect(off).toEqual(["Thematic Innovation (iA)", "Dividend Growth (iA)", "Global Opportunities (Loomis Sayles)"]);
    expect(c.offModelPct).toBeGreaterThan(40);
    expect(c.rows.find((r) => r.name === "Fidelity Insights")!.actualPct).toBe(0);
    expect(compareToModel([], balanced)).toBeNull();
  });
  it("puts it in the pack: an exception per off-model account and a household table", () => {
    const funds = [{ name: "3233H-NSC-Thematic Innovation (iA)", category: "U.S. & International Equity Funds", value: 30_000 }, { name: "3603H-NSC-Fixed Income Managed Portfolio (iA)", category: "Income Funds", value: 70_000 }];
    const p = buildPortfolioPack({ accounts: [acct({ statement: { statementDate: "2026-09-30", funds } })], profiles: [{ accountNumber: null, label: null, incomePct: 40, equityPct: 60, bandPct: 0, profileKey: "balanced" }], today: "2026-10-14", models: [balanced] });
    expect(p.household.modelComparison!.offModelPct).toBe(30);
    expect(p.exceptions.some((e) => /not in the Balanced model \(Thematic Innovation \(iA\)\)/.test(e.text))).toBe(true);
  });
});

describe("a reset is sized on the latest value, not the older statement's", () => {
  it("uses the monthly import's value when it is newer than the statement's fund value", () => {
    const acc: PackAccount = { ...acct(), value: 96_000, ownerDob: "1955-06-01", guarantee: { series: "Series 75/100", maturityDate: null, guaranteedAtMaturity: 1, guaranteedAtDeath: 92_000, lastQuarterFee: 1, valueOfFunds: 100_000 } };
    const row = resetCheck([acc], "2026-10-14").rows[0];
    expect(row.fundValue).toBe(96_000);
    expect(row.room).toBe(4_000);
  });
  it("falls back to the statement's fund value when there is no import value", () => {
    const acc: PackAccount = { ...acct(), value: null, ownerDob: "1955-06-01", guarantee: { series: "Series 75/100", maturityDate: null, guaranteedAtMaturity: 1, guaranteedAtDeath: 92_000, lastQuarterFee: 1, valueOfFunds: 100_000 } };
    expect(resetCheck([acc], "2026-10-14").rows[0].room).toBe(8_000);
  });
});
