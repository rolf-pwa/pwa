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

describe("what could be drawn this year", () => {
  it("is the lesser of this year's surplus and the income funds, account by account", () => {
    // Surplus 10,000 against income 30,000 -> 10,000. Surplus 25,000 against income 12,000 -> 12,000.
    const v = liquidityView([acct("1"), acct("2", { current_value: 115_000, income_funds_value: 12_000 })], []);
    expect(v.lines.map((l) => [l.available, l.limitedBy])).toEqual([[10_000, "surplus"], [12_000, "income_funds"]]);
    expect(v.availableThisYear).toBe(22_000);
    expect(v.availableCovered).toBe(2);
  });
  it("is nothing for an account with no surplus, and unknown without a starting balance", () => {
    const v = liquidityView([acct("1", { current_value: 85_000 }), acct("2", { book_value: null })], []);
    expect(v.lines.find((l) => l.id === "1")!.available).toBe(0);
    expect(v.lines.find((l) => l.id === "2")!.available).toBeNull();
    expect(v.availableThisYear).toBe(0);
    expect(v.availableCovered).toBe(1);
    expect(liquidityView([acct("1", { book_value: null })], []).availableThisYear).toBeNull();
  });
  it("reads numbers that arrive as text, as database numerics do", () => {
    const v = liquidityView([acct("1", { current_value: "100000.50", book_value: "90000", income_funds_value: "30000" })], []);
    expect(v.incomeFunds).toBe(30_000);
    expect(v.availableThisYear).toBe(10_000.5);
  });
  it("shows the last four digits of the account number only", () => {
    expect(liquidityView([acct("7")], []).lines[0].last4).toBe("0007");
    expect(JSON.stringify(liquidityView([acct("7")], []))).not.toContain("182000007");
  });
});
