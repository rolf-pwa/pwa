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

describe("the rebalancing proposal", () => {
  const bal: ModelPortfolio = { asOf: "2026-05-31", key: "balanced", label: "Balanced", incomeMin: 35, incomeMax: 55, equityMin: 45, equityMax: 65, incomeTarget: 40, funds: [] };
  const inc = (income: number, equity: number) => [{ name: "I", category: "Income Funds", value: income * 1000 }, { name: "E", category: "Canadian Equity funds", value: equity * 1000 }];
  const pr = [{ accountNumber: null, label: null, incomePct: 40, equityPct: 60, bandPct: 0, profileKey: "balanced" }];
  const withGuarantee = (over: Partial<PackAccount>): PackAccount => acct({ ownerDob: "1955-06-01", guarantee: { series: "Series 75/100", maturityDate: null, guaranteedAtMaturity: 1, guaranteedAtDeath: 90_000, lastQuarterFee: 1, valueOfFunds: 100_000 }, ...over });

  it("switches by asset class inside the account to reach the model mix, and says which are outside the range", () => {
    const p = buildPortfolioPack({ accounts: [acct({ id: "a", number: "1111", value: 100_000, type: "TFSA", statement: { statementDate: "2026-09-30", funds: inc(34, 66) } }), acct({ id: "b", number: "2222", value: 50_000, type: "RRIF", statement: { statementDate: "2026-09-30", funds: inc(36, 64) } })], profiles: pr, today: "2026-10-14", models: [bal] });
    const [a, b] = p.rebalancing.rows;
    expect(a).toMatchObject({ accountId: "a", direction: "to_income", amount: 6_000, outsideRange: true, afterIncomePct: 40, taxable: false });
    expect(b).toMatchObject({ accountId: "b", direction: "to_income", amount: 2_000, outsideRange: false });
    expect(p.rebalancing.toIncome).toBe(8_000);
    expect(p.rebalancing.needed).toBe(1);
  });
  it("moves into equity when an account holds too much income", () => {
    const p = buildPortfolioPack({ accounts: [acct({ value: 100_000, statement: { statementDate: "2026-09-30", funds: inc(60, 40) } })], profiles: pr, today: "2026-10-14", models: [bal] });
    expect(p.rebalancing.rows[0]).toMatchObject({ direction: "to_equity", amount: 20_000 });
    expect(p.rebalancing.toEquity).toBe(20_000);
  });
  it("flags non-registered accounts as taxable and lists the guarantee reset with the switch", () => {
    const p = buildPortfolioPack({ accounts: [withGuarantee({ id: "n", type: "Non-registered", value: 100_000, boyValue: 90_000, statement: { statementDate: "2026-09-30", funds: inc(34, 66) } })], profiles: pr, today: "2026-10-14", models: [bal] });
    expect(p.rebalancing.rows[0]).toMatchObject({ taxable: true, ytdGain: 10_000, resetLift: 10_000 });
    expect(p.rebalancing.taxable).toBe(1);
    expect(p.rebalancing.resets).toBe(1);
    expect(p.rebalancing.resetLift).toBe(10_000);
  });
  it("lists an aligned account only when it has a reset, and leaves out accounts with no profile or no funds", () => {
    const p = buildPortfolioPack({ accounts: [withGuarantee({ id: "ok", value: 100_000, statement: { statementDate: "2026-09-30", funds: inc(40, 60) } }), acct({ id: "plain", statement: { statementDate: "2026-09-30", funds: inc(40, 60) } }), acct({ id: "nofunds", statement: null })], profiles: pr, today: "2026-10-14", models: [bal] });
    expect(p.rebalancing.rows.map((r) => [r.accountId, r.direction])).toEqual([["ok", "none"]]);
    const none = buildPortfolioPack({ accounts: [acct({ statement: { statementDate: "2026-09-30", funds: inc(30, 70) } })], profiles: [], today: "2026-10-14", models: [] });
    expect(none.rebalancing.rows).toEqual([]);
  });
});

import { rebalancingWorksheet } from "../../supabase/functions/_shared/portfolio-review";
describe("the rebalancing worksheet", () => {
  it("lists each switch, the flags and the totals as plain text", () => {
    const bal: ModelPortfolio = { asOf: "2026-05-31", key: "balanced", label: "Balanced", incomeMin: 35, incomeMax: 55, equityMin: 45, equityMax: 65, incomeTarget: 40, funds: [] };
    const funds = [{ name: "I", category: "Income Funds", value: 34_000 }, { name: "E", category: "Canadian Equity funds", value: 66_000 }];
    const p = buildPortfolioPack({ accounts: [acct({ type: "Non-registered", number: "1818713190", value: 100_000, ownerDob: "1955-06-01", guarantee: { series: "Series 75/100", maturityDate: null, guaranteedAtMaturity: 1, guaranteedAtDeath: 90_000, lastQuarterFee: 1, valueOfFunds: 100_000 }, statement: { statementDate: "2026-09-30", funds } })], profiles: [{ accountNumber: null, label: null, incomePct: 40, equityPct: 60, bandPct: 0, profileKey: "balanced" }], today: "2026-10-14", models: [bal] });
    const t = rebalancingWorksheet(p.rebalancing, "Parent Household", p.asOf);
    expect(t).toContain("Rebalancing worksheet: Parent Household");
    expect(t).toMatch(/…3190 \(Sam\): switch about \$6,000 from equity into income funds \(34% income to 40%\)\. OUTSIDE RANGE; TAXABLE: estimated gain about \$600 on book value \$90,000; then reset the death guarantee \(\+\$10,000\)/);
    expect(t).toContain("Total: $6,000 into income funds, $0 into equity funds. 1 reset adding $10,000.");
  });
});

import { estimateSwitchGain } from "../../supabase/functions/_shared/portfolio-review";
describe("estimated capital gain on a switch", () => {
  it("is the switched share of the account's gain", () => {
    expect(estimateSwitchGain(200_000, 100_000, 40_000)).toBe(20_000); // half the account is gain
    expect(estimateSwitchGain(150_000, 120_000, 15_000)).toBe(3_000);
  });
  it("is a loss when the account is under its book value", () => {
    expect(estimateSwitchGain(90_000, 100_000, 9_000)).toBe(-1_000);
  });
  it("is null when the figures are missing", () => {
    expect(estimateSwitchGain(null, 100_000, 5_000)).toBeNull();
    expect(estimateSwitchGain(100_000, null, 5_000)).toBeNull();
    expect(estimateSwitchGain(100_000, 80_000, 0)).toBeNull();
  });
});

import { holdingsAge, applyResetRecord, HOLDINGS_STALE_DAYS } from "../../supabase/functions/_shared/portfolio-review";
describe("how old the holdings behind the mix are", () => {
  const acc = (date: string | null, funds = 1) => ({ statement: date ? { statementDate: date, funds: Array(funds).fill({}) } : null });
  it("uses the oldest statement and counts accounts with no fund detail", () => {
    const h = holdingsAge([acc("2026-06-30"), acc("2026-09-30"), acc(null)], "2026-10-16");
    expect(h).toEqual({ asOf: "2026-06-30", ageDays: 108, stale: false, missing: 1 });
  });
  it("is stale past 120 days, and not before", () => {
    expect(HOLDINGS_STALE_DAYS).toBe(120);
    expect(holdingsAge([acc("2026-06-30")], "2026-10-28").stale).toBe(false); // 120 days
    expect(holdingsAge([acc("2026-06-30")], "2026-10-29").stale).toBe(true); // 121 days
  });
  it("has no age when nothing has been scanned", () => {
    expect(holdingsAge([acc(null), acc("2026-06-30", 0)], "2026-10-16")).toEqual({ asOf: null, ageDays: null, stale: false, missing: 2 });
  });
});

describe("a reset recorded after the statement", () => {
  const g = { series: "Series 75/100", maturityDate: null, guaranteedAtMaturity: 1, guaranteedAtDeath: 90_000, lastQuarterFee: 1, valueOfFunds: 100_000 };
  it("replaces the statement's guarantee when it is newer", () => {
    expect(applyResetRecord(g, "2026-06-30", { date: "2026-10-01", guaranteedAtDeath: 120_000 })?.guaranteedAtDeath).toBe(120_000);
  });
  it("is ignored when the statement already reflects it, or has no amount", () => {
    expect(applyResetRecord(g, "2026-09-30", { date: "2026-09-30", guaranteedAtDeath: 120_000 })).toBe(g);
    expect(applyResetRecord(g, "2026-06-30", { date: "2026-10-01", guaranteedAtDeath: null })).toBe(g);
    expect(applyResetRecord(g, "2026-06-30", null)).toBe(g);
    expect(applyResetRecord(null, "2026-06-30", { date: "2026-10-01", guaranteedAtDeath: 1 })).toBeNull();
  });
});

describe("an account that stopped reporting", () => {
  const withDates = (asOfs: (string | null)[]) => buildPortfolioPack({ accounts: asOfs.map((d, i) => acct({ id: `a${i}`, number: `${1000 + i}`, asOf: d })), profiles: [], today: "2026-10-16", models: [] });
  it("asks whether it has closed when its value is much older than the household's newest", () => {
    const g = withDates(["2026-09-30", "2026-06-30"]).gaps.filter((x) => x.includes("no monthly value since"));
    expect(g).toHaveLength(1);
    expect(g[0]).toContain("2026-06-30");
    expect(g[0]).toMatch(/mark it closed/);
  });
  it("says nothing when every account reported within a month or so", () => {
    expect(withDates(["2026-09-30", "2026-08-31"]).gaps.filter((x) => x.includes("monthly value"))).toEqual([]);
  });
  it("flags an account with no monthly value at all, once others have one", () => {
    expect(withDates(["2026-09-30", null]).gaps.some((x) => x.includes("no monthly value on file"))).toBe(true);
  });
  it("leaves a zero balance out, so a closed account stops showing", () => {
    const p = buildPortfolioPack({ accounts: [acct({ id: "a", asOf: "2026-09-30" }), acct({ id: "b", number: "2", value: 0, asOf: "2026-09-30" })], profiles: [], today: "2026-10-16", models: [] });
    expect(p.accounts.map((a) => a.id)).toEqual(["a"]);
  });
});
