import { describe, expect, it } from "vitest";
import { availableForWithdrawal, computeAvailability, withdrawalsTotal, INCOME_CATEGORY, isIncomeFund } from "../../supabase/functions/_shared/withdrawal-availability";

// The Investment Funds table on page 2 of the real iA statement (Series 75/100).
const page2 = [
  { name: "36033-NSC-Fixed Income Managed Portfolio (iA)", category: "Income Funds", value: 23.52 },
  { name: "36953-NSC-Dividend Growth (iA)", category: "Canadian Equity funds", value: 3_430.94 },
  { name: "37903-NSC-Fidelity Canadian Opportunities", category: "Canadian Equity funds", value: 9_494.54 },
  { name: "30193-NSC-Global Opportunities (Loomis Sayles)", category: "U.S. & International Equity Funds", value: 15_202.07 },
  { name: "33583-NSC-Global Equity Opportunistic Value", category: "U.S. & International Equity Funds", value: 10_469.58 },
  { name: "32333-NSC-Thematic Innovation (iA)", category: "U.S. & International Equity Funds", value: 10_027.53 },
];
const account = { book_value: 51_295.72, current_value: 53_143.02 };
// What the six funds above don't explain: 53,143.02 - 48,648.18.
const rest = { name: "Other holdings (rest of statement)", category: "Balanced Funds", value: 4_494.84 };

describe("computeAvailability", () => {
  it("real iA statement, full fund list: surplus $1,847.30 but only $23.52 of income funds, so $23.52 is available", () => {
    const av = computeAvailability({ ...account, funds: [...page2, rest] });
    expect(av.status).toBe("confirmed");
    expect(av.surplus).toBe(1_847.3);
    expect(av.income_funds).toBe(23.52);
    expect(av.available).toBe(23.52);
    expect(av.limited_by).toBe("income_funds");
    expect(av.funds_total).toBe(53_143.02);
    expect(av.notes.join(" ")).toMatch(/exceeds the income funds on hand/);
  });
  it("flags the page-2-only extraction as unconfirmed (funds total $48,648.18 vs $53,143.02) instead of presenting it as fact", () => {
    const av = computeAvailability({ ...account, funds: page2 });
    expect(av.status).toBe("unconfirmed");
    expect(av.funds_total).toBe(48_648.18);
    expect(av.funds_gap).toBe(4_494.84);
    expect(av.available).toBe(23.52); // still shown, but marked unconfirmed
    expect(av.notes.join(" ")).toMatch(/\$4,494\.84 not accounted for/);
  });
  it("surplus is the limit when income funds exceed it", () => {
    const av = computeAvailability({ ...account, funds: [{ name: "Bond", category: "Income Funds", value: 5_000 }, { name: "Eq", category: "Equity", value: 48_143.02 }] });
    expect(av.available).toBe(1_847.3);
    expect(av.limited_by).toBe("surplus");
    expect(av.status).toBe("confirmed");
  });
  it("no surplus (current at or below opening) means nothing is available without touching principal", () => {
    const av = computeAvailability({ book_value: 60_000, current_value: 53_143.02, funds: [{ name: "Bond", category: "Income Funds", value: 53_143.02 }] });
    expect(av.surplus).toBe(-6_856.98);
    expect(av.available).toBe(0);
    expect(av.limited_by).toBe("surplus");
    expect(av.notes.join(" ")).toMatch(/no surplus/);
  });
  it("no fund holdings extracted: the surplus is known but the income funds, and so the availability, are not", () => {
    const av = computeAvailability({ ...account, funds: null });
    expect(av.status).toBe("insufficient");
    expect(av.surplus).toBe(1_847.3);
    expect(av.income_funds).toBeNull();
    expect(av.available).toBeNull();
  });
  it("no opening balance: cannot work out a surplus", () => {
    const av = computeAvailability({ current_value: 53_143.02, funds: [...page2, rest] });
    expect(av.status).toBe("insufficient");
    expect(av.surplus).toBeNull();
    expect(av.available).toBeNull();
  });
  it("no fund under an Income heading means $0 income funds (and says so)", () => {
    const av = computeAvailability({ ...account, funds: [{ name: "Eq", category: "Equity", value: 53_143.02 }] });
    expect(av.income_funds).toBe(0);
    expect(av.available).toBe(0);
    expect(av.notes.join(" ")).toMatch(/Nothing was listed as income, money market, cash or HISA/);
  });
  it("ignores fund lines without a numeric value and tolerates only rounding in the sum", () => {
    const withJunk = computeAvailability({ ...account, funds: [...page2, rest, { name: "bad", category: "Income Funds", value: null }] });
    expect(withJunk.funds.length).toBe(7);
    expect(computeAvailability({ ...account, funds: [...page2, { ...rest, value: 4_495.34 }] }).status).toBe("confirmed"); // $0.50 off
    expect(computeAvailability({ ...account, funds: [...page2, { ...rest, value: 4_595.34 }] }).status).toBe("unconfirmed"); // $100.50 off
  });
  it("income definition: income, fixed income, money market, cash and HISA count; equity, balanced, GICs and look-alikes do not", () => {
    for (const c of ["Income Funds", "Fixed Income", "income", "Money Market", "Money-Market Funds", "Cash", "Cash & equivalents", "HISA", "High Interest Savings Account", "High-interest savings", "Cash and Short-Term"]) {
      expect(INCOME_CATEGORY.test(c), c).toBe(true);
    }
    for (const c of ["Canadian Equity funds", "U.S. & International Equity Funds", "Balanced Funds", "Incomex", "Cashable GICs", "Guaranteed Investment Certificates", "Savings and Retirement"]) {
      expect(INCOME_CATEGORY.test(c), c).toBe(false);
    }
  });
  it("falls back to the fund's name when no category heading was printed", () => {
    expect(isIncomeFund({ name: "High Interest Savings Account", category: null })).toBe(true);
    expect(isIncomeFund({ name: "Money Market Fund", category: "" })).toBe(true);
    expect(isIncomeFund({ name: "Dividend Growth", category: null })).toBe(false);
    // a printed heading wins over the name
    expect(isIncomeFund({ name: "Cash Management Equity Fund", category: "Canadian Equity funds" })).toBe(false);
  });
  it("money market, cash and HISA lines add to the income funds balance and the available amount", () => {
    // The six page-2 funds ($48,648.18) + $1,100 of HISA / money market / cash + $3,394.84 of other holdings = $53,143.02.
    const av = computeAvailability({ ...account, funds: [...page2,
      { name: "Daily Interest Savings", category: "HISA", value: 400 },
      { name: "Money Market Fund", category: "Money Market", value: 600 },
      { name: "Cash", category: "Cash", value: 100 },
      { ...rest, value: 3_394.84 }] });
    expect(av.status).toBe("confirmed");
    expect(av.income_funds).toBe(1_123.52); // 23.52 income + 400 + 600 + 100
    expect(av.available).toBe(1_123.52);
    expect(av.limited_by).toBe("income_funds");
  });
});

describe("availableForWithdrawal (the rule the account cards use from three stored numbers)", () => {
  it("the real iA account: surplus $1,847.30, income funds $23.52 -> $23.52 available, limited by income funds", () => {
    expect(availableForWithdrawal({ book_value: 51_295.72, current_value: 53_143.02, income_funds_value: 23.52 }))
      .toEqual({ surplus: 1_847.3, available: 23.52, limited_by: "income_funds" });
  });
  it("is limited by the surplus when income funds exceed it, and by neither when equal", () => {
    expect(availableForWithdrawal({ book_value: 100, current_value: 150, income_funds_value: 500 })).toEqual({ surplus: 50, available: 50, limited_by: "surplus" });
    expect(availableForWithdrawal({ book_value: 100, current_value: 150, income_funds_value: 50 })).toEqual({ surplus: 50, available: 50, limited_by: "none" });
  });
  it("never goes below zero when there is no surplus (that would be principal)", () => {
    expect(availableForWithdrawal({ book_value: 200, current_value: 150, income_funds_value: 150 })).toEqual({ surplus: -50, available: 0, limited_by: "surplus" });
  });
  it("is null when a figure is missing, and agrees with computeAvailability", () => {
    expect(availableForWithdrawal({ book_value: 100, current_value: 150 }).available).toBeNull();
    expect(availableForWithdrawal({ book_value: null, current_value: 150, income_funds_value: 10 }).available).toBeNull();
    const funds = [{ name: "Bond", category: "Income Funds", value: 23.52 }, { name: "Eq", category: "Equity", value: 53_119.5 }];
    const av = computeAvailability({ book_value: 51_295.72, current_value: 53_143.02, funds });
    expect(availableForWithdrawal({ book_value: 51_295.72, current_value: 53_143.02, income_funds_value: av.income_funds }).available).toBe(av.available);
  });
});

describe("withdrawalsTotal", () => {
  const hisa = { fund: "High Interest Savings Account (HISA)", category: "Income Funds" };
  it("sums withdrawals from every fund", () => {
    expect(withdrawalsTotal([
      { ...hisa, date: "2026-05-11", amount: 15283.87 },
      { ...hisa, date: "2026-06-01", amount: 200 },
      { fund: "Global Equity Fund", category: "U.S. & International Equity Funds", amount: 5000 },
    ])).toBe(20483.87);
  });
  it("ignores transfers/switches and non-positive amounts", () => {
    expect(withdrawalsTotal([
      { fund: "Switch to equity", category: "Income Funds", amount: 3000 },
      { ...hisa, amount: -50 },
      { ...hisa, amount: 0 },
    ])).toBe(0);
  });
  it("is null when nothing was read and 0 for an empty list", () => {
    expect(withdrawalsTotal(null)).toBeNull();
    expect(withdrawalsTotal(undefined)).toBeNull();
    expect(withdrawalsTotal([])).toBe(0);
  });
  it("is carried on computeAvailability", () => {
    expect(computeAvailability({ book_value: 100, current_value: 90, withdrawals: [{ ...hisa, amount: 10 }] }).withdrawals_ytd).toBe(10);
    expect(computeAvailability({ book_value: 100, current_value: 90 }).withdrawals_ytd).toBeNull();
  });
});
