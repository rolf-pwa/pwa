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
