import { describe, expect, it } from "vitest";
import { coverageText, liquidityView, type LiquidityAccount } from "../../supabase/functions/_shared/vfo-liquidity";

// A made-up household: no Liquidity Reserve set up, three statement accounts and one without a statement.
const acct = (id: string, o: Partial<LiquidityAccount> = {}): LiquidityAccount => ({ id, account_name: `iA ${id}`, account_number: `18200000${id.padStart(2, "0")}`, account_type: "RRSP", current_value: 100_000, book_value: 90_000, income_funds_value: 30_000, income_funds_as_of: "2026-10-30", ...o });

describe("the Liquidity Reserve in the VFO, when none is set up", () => {
  it("counts the income funds in the accounts as the reserve, and keeps them as part of the Vineyard", () => {
    const v = liquidityView([acct("1"), acct("2", { income_funds_value: 12_000 })], []);
    expect(v.counted).toBe(true);
    expect(v.incomeFunds).toBe(42_000);
    expect(v.reserve).toBe(42_000);
    expect(v.lines.map((l) => l.incomeFunds)).toEqual([30_000, 12_000]);
    expect(v.asOf).toBe("2026-10-30");
  });
  it("adds the income funds to a Liquidity storehouse that has no target", () => {
    const v = liquidityView([acct("1")], [{ storehouse_number: 1, current_value: 5_000, target_value: null }]);
    expect(v).toMatchObject({ counted: true, storehouseLiquidity: 5_000, incomeFunds: 30_000, reserve: 35_000 });
  });
  it("leaves the household's own Liquidity Reserve alone when one is set up with a target", () => {
    const v = liquidityView([acct("1")], [{ storehouse_number: 1, current_value: 80_000, target_value: 150_000 }]);
    expect(v).toMatchObject({ counted: false, reserve: 80_000, incomeFunds: 0, lines: [] });
  });
  it("ignores the other storehouses", () => {
    const v = liquidityView([acct("1")], [{ storehouse_number: 2, current_value: 51_624, target_value: null }]);
    expect(v).toMatchObject({ storehouseLiquidity: 0, reserve: 30_000 });
  });
  it("caps an income funds figure at the account's value, as the balance sheet does", () => {
    expect(liquidityView([acct("1", { current_value: 20_000, income_funds_value: 35_000 })], []).incomeFunds).toBe(20_000);
  });
  it("says how many accounts it covers when some have not been read, and counts only accounts that issue a statement", () => {
    const v = liquidityView([acct("1"), acct("2", { income_funds_value: null }), acct("3", { account_number: "", income_funds_value: null })], []);
    expect(v).toMatchObject({ covered: 1, expected: 2, incomeFunds: 30_000 });
    expect(coverageText(v)).toBe("Based on 1 of your 2 accounts: the rest are still being read.");
    expect(coverageText(liquidityView([acct("1")], []))).toBeNull();
  });
  it("is not counted at all while no account has its income funds read", () => {
    const v = liquidityView([acct("1", { income_funds_value: null })], []);
    expect(v).toMatchObject({ counted: false, covered: 0, expected: 1, reserve: 0 });
  });
});

describe("the figures it gives", () => {
  it("reads numbers that arrive as text, as database numerics do", () => {
    const v = liquidityView([acct("1", { current_value: "100000.50", book_value: "90000", income_funds_value: "30000" })], []);
    expect(v.incomeFunds).toBe(30_000);
  });
  it("shows the last four digits of the account number only", () => {
    expect(liquidityView([acct("7")], []).lines[0].last4).toBe("0007");
    expect(JSON.stringify(liquidityView([acct("7")], []))).not.toContain("182000007");
  });
});

describe("what could be drawn this year: the Charter's Liquidity Reserve less the withdrawals so far, never more than the income funds held", () => {
  // Two statement accounts (income funds 30,000 and 12,000 = 42,000 held), each with its year-to-date withdrawals read.
  const accts = (w1: number | null, w2: number | null) => [acct("1", { withdrawals_ytd: w1, withdrawals_as_of: "2026-06-30" }), acct("2", { income_funds_value: 12_000, withdrawals_ytd: w2, withdrawals_as_of: "2026-09-30" })];

  it("is the Charter amount less the withdrawals, when that is within what is held", () => {
    const v = liquidityView(accts(5_000, 3_000), [], { charterAmount: 40_000 });
    expect(v.draw).toEqual({ charterAmount: 40_000, withdrawn: 8_000, available: 32_000, limitedBy: "charter", asOf: "2026-09-30" });
  });
  it("is never more than the income funds held", () => {
    const v = liquidityView(accts(0, 0), [], { charterAmount: 150_000 });
    expect(v.draw).toMatchObject({ available: 42_000, limitedBy: "held" });
  });
  it("is nothing once the withdrawals have used the Charter amount up", () => {
    expect(liquidityView(accts(30_000, 15_000), [], { charterAmount: 40_000 }).draw).toMatchObject({ available: 0, withdrawn: 45_000 });
  });
  it("is not worked out without a Charter amount, or with a zero or unreadable one", () => {
    for (const c of [null, undefined, 0, "", "abc"]) expect(liquidityView(accts(0, 0), [], { charterAmount: c as never }).draw, String(c)).toBeNull();
  });
  it("is not worked out while any statement account has no withdrawals figure: a number that might be too high is not shown", () => {
    expect(liquidityView(accts(5_000, null), [], { charterAmount: 40_000 }).draw).toBeNull();
    expect(liquidityView([acct("1", { withdrawals_ytd: 0 }), acct("3", { account_number: "", withdrawals_ytd: null, income_funds_value: null })], [], { charterAmount: 40_000 }).draw).toMatchObject({ available: 30_000 });
  });
  it("is not worked out when the household has its own Liquidity Reserve set up, or no income funds are read", () => {
    expect(liquidityView(accts(0, 0), [{ storehouse_number: 1, current_value: 80_000, target_value: 150_000 }], { charterAmount: 40_000 }).draw).toBeNull();
    expect(liquidityView([acct("1", { income_funds_value: null, withdrawals_ytd: 0 })], [], { charterAmount: 40_000 }).draw).toBeNull();
  });
  it("reads numbers that arrive as text, and counts the withdrawals of an account whose income funds are not yet read", () => {
    const v = liquidityView([acct("1", { withdrawals_ytd: "1000.50" }), acct("4", { income_funds_value: null, withdrawals_ytd: "17250" })], [], { charterAmount: "40000" });
    expect(v.draw).toMatchObject({ withdrawn: 18_250.5, available: 21_749.5 });
  });
});
