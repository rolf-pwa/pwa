import { describe, expect, it } from "vitest";
import { allocateCapital, hasLiquidityReserve, type AllocInput } from "../../supabase/functions/_shared/quarterly-review-allocation";

const base = (o: Partial<AllocInput> = {}): AllocInput => ({
  aum: 920_598, netWorth: 920_598, holdingTank: 10_000, vineyard: 910_264,
  reserves: { liquidity: 334, strategic: 0, philanthropic: 0, legacy: 0 },
  liquidityStorehouse: { exists: true, target: null },
  accounts: [
    { bucket: "vineyard", current_value: 415_348.78, income_funds_value: 20_000, withdrawals_ytd: 15_283.87 },
    { bucket: "vineyard", current_value: 494_915.17, income_funds_value: 5_000, withdrawals_ytd: 0 },
    { bucket: "holding_tank", current_value: 10_000, income_funds_value: null, withdrawals_ytd: null },
  ],
  policies: [{ cash_value: 59_467, cash_value_storehouse_id: null }],
  ...o,
});

describe("allocateCapital", () => {
  it("counts a Liquidity Reserve only when it exists with a target", () => {
    expect(hasLiquidityReserve({ exists: true, target: 50_000 })).toBe(true);
    expect(hasLiquidityReserve({ exists: true, target: null })).toBe(false);
    expect(hasLiquidityReserve({ exists: true, target: 0 })).toBe(false);
    expect(hasLiquidityReserve({ exists: false, target: null })).toBe(false);
  });
  it("moves income funds out of the Vineyard into Liquidity when no reserve is set up; AUM unchanged by that move", () => {
    const r = allocateCapital(base({ policies: [] }));
    expect(r.incomeFundsMoved).toBe(25_000);
    expect(r.vineyard).toBe(885_264);
    expect(r.reserves.liquidity).toBe(25_334);
    expect(r.holdingTank + r.vineyard + r.reserves.liquidity).toBe(920_598);
    expect(r.aum).toBe(920_598);
  });
  it("leaves a deliberate Liquidity Reserve alone", () => {
    const r = allocateCapital(base({ liquidityStorehouse: { exists: true, target: 50_000 }, policies: [] }));
    expect(r.incomeFundsMoved).toBe(0);
    expect(r.incomeFundsOnFile).toBe(25_000);
    expect(r.vineyard).toBe(910_264);
    expect(r.reserves.liquidity).toBe(334);
  });
  it("adds unlinked insurance cash value to Strategic, AUM and net worth", () => {
    const r = allocateCapital(base());
    expect(r.cashValueAdded).toBe(59_467);
    expect(r.reserves.strategic).toBe(59_467);
    expect(r.aum).toBe(980_065);
    expect(r.netWorth).toBe(980_065);
  });
  it("does not double count cash value already booked against a storehouse", () => {
    const r = allocateCapital(base({ policies: [{ cash_value: 59_467, cash_value_storehouse_id: "s2" }] }));
    expect(r.cashValueAdded).toBe(0);
    expect(r.reserves.strategic).toBe(0);
  });
  it("harvest = total of all withdrawals across all accounts, and says how many accounts have data", () => {
    const r = allocateCapital(base());
    expect(r.totalWithdrawals).toBe(15_283.87);
    expect(r.harvest).toBe(15_283.87);
    expect(r.accountsWithWithdrawalData).toBe(2);
    expect(r.notes.join(" ")).toMatch(/2 of 3 accounts/);
  });
  it("leaves accounts with no statement (e.g. a GIC) out of the 'still to read' note", () => {
    const accounts = [
      { bucket: "vineyard" as const, current_value: 100, income_funds_value: 10, withdrawals_ytd: 5, expects_statement: true },
      { bucket: "vineyard" as const, current_value: 100, income_funds_value: 10, withdrawals_ytd: 7, expects_statement: true },
      { bucket: "holding_tank" as const, current_value: 10_000, income_funds_value: null, withdrawals_ytd: null, expects_statement: false },
    ];
    const r = allocateCapital(base({ accounts, policies: [] }));
    expect(r.harvest).toBe(12);
    expect(r.notes.join(" ")).not.toMatch(/of 3|of 2|run a Vault scan/);
  });
  it("still asks for a scan when an account that has a statement hasn't been read", () => {
    const accounts = [
      { bucket: "vineyard" as const, current_value: 100, income_funds_value: 10, withdrawals_ytd: 5, expects_statement: true },
      { bucket: "vineyard" as const, current_value: 100, income_funds_value: null, withdrawals_ytd: null, expects_statement: true },
      { bucket: "holding_tank" as const, current_value: 10_000, income_funds_value: null, withdrawals_ytd: null, expects_statement: false },
    ];
    expect(allocateCapital(base({ accounts, policies: [] })).notes.join(" ")).toMatch(/1 of 2 accounts with statements/);
  });
  it("harvest is unknown (null), not zero, until withdrawals have been read", () => {
    const r = allocateCapital(base({ accounts: base().accounts.map((a) => ({ ...a, withdrawals_ytd: null })) }));
    expect(r.harvest).toBeNull();
    expect(r.notes.join(" ")).toMatch(/run a Vault scan/);
  });
  it("caps income funds at the account value and never goes negative", () => {
    const r = allocateCapital(base({ accounts: [{ bucket: "holding_tank", current_value: 100, income_funds_value: 5_000, withdrawals_ytd: null }], holdingTank: 100, vineyard: 0, policies: [] }));
    expect(r.holdingTank).toBe(0);
    expect(r.reserves.liquidity).toBe(434);
  });
  it("is a no-op for a household with nothing to allocate", () => {
    const r = allocateCapital(base({ accounts: [], policies: [] }));
    expect(r).toMatchObject({ aum: 920_598, vineyard: 910_264, holdingTank: 10_000, harvest: null, notes: [] });
  });
});
