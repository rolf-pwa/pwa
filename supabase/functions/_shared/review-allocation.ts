// Shared by the Sovereignty Review and the Stabilization Map: gathers what the capital-allocation rules need
// (income funds and withdrawals on each account, real-estate Storehouse rows, insurance cash value) and returns
// the household's balance-sheet figures. The pure rules live in quarterly-review-allocation.ts.
//
// The shared diagnostics (sovereignty-diagnostics.ts) are NOT changed: they leave real estate out of AUM and the
// reserves and know nothing of income funds, so each document applies these rules on top of them.

// deno-lint-ignore-file no-explicit-any
import { allocateCapital, type AllocAccount, type Allocation } from "./quarterly-review-allocation.ts";

/** Storehouse rows of this type are real estate; the shared diagnostics leave them out of the reserve totals. */
export const REAL_ESTATE_ASSET_TYPE = "Primary Residence & Protected Legacy Accounts";

const nn = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);

export async function allocateForHousehold(
  supabase: any,
  financials: { holdingTank: any[]; vineyardAccounts: any[]; storehouses: any[]; insurancePolicies: any[]; liabilities?: any[] },
  diag: { aum: number; net_worth: number; holding_tank_total: number; vineyard_total: number; storehouse_reserves: Allocation["reserves"] },
) {
  const { data: tankRows } = financials.holdingTank.length
    ? await supabase.from("holding_tank").select("id, account_number, current_value, income_funds_value, withdrawals_ytd, income_funds_as_of, withdrawals_as_of").in("id", financials.holdingTank.map((h: any) => h.id))
    : { data: [] };
  const toAccount = (bucket: AllocAccount["bucket"]) => (a: any): AllocAccount => ({
    bucket, current_value: nn(a.current_value), income_funds_value: nn(a.income_funds_value),
    withdrawals_ytd: nn(a.withdrawals_ytd), expects_statement: !!String(a.account_number ?? "").trim(),
    as_of: (a.income_funds_as_of ?? a.withdrawals_as_of ?? null) as string | null,
  });
  const allocAccounts: AllocAccount[] = [
    ...financials.vineyardAccounts.map(toAccount("vineyard")),
    ...(tankRows ?? []).map(toAccount("holding_tank")),
  ];
  const liquidityRow = financials.storehouses.find((x) => x.storehouse_number === 1 && x.asset_type !== REAL_ESTATE_ASSET_TYPE);
  const realEstate = { liquidity: 0, strategic: 0, philanthropic: 0, legacy: 0 };
  const keyOf: Record<number, keyof typeof realEstate> = { 1: "liquidity", 2: "strategic", 3: "philanthropic", 4: "legacy" };
  for (const s of financials.storehouses) {
    const key = keyOf[s.storehouse_number];
    if (s.asset_type === REAL_ESTATE_ASSET_TYPE && key) realEstate[key] += nn(s.current_value) ?? 0;
  }
  const allocation = allocateCapital({
    aum: diag.aum, netWorth: diag.net_worth, holdingTank: diag.holding_tank_total, vineyard: diag.vineyard_total,
    reserves: diag.storehouse_reserves,
    liquidityStorehouse: { exists: !!liquidityRow, target: nn(liquidityRow?.target_value) },
    accounts: allocAccounts, realEstate,
    credit: (financials.liabilities ?? []).filter((l) => l.holder_type === "contact"),
    policies: financials.insurancePolicies.map((p) => ({ cash_value: nn(p.cash_value), cash_value_storehouse_id: p.cash_value_storehouse_id ?? null })),
  });
  return { allocation, allocAccounts };
}

/** The diagnostics with the allocated figures swapped in (everything else unchanged). */
export function applyAllocation<T extends { aum: number; net_worth: number; holding_tank_total: number; vineyard_total: number; storehouse_reserves: Allocation["reserves"] }>(
  diag: T, allocation: Allocation,
): T {
  return {
    ...diag, aum: allocation.aum, net_worth: allocation.netWorth, holding_tank_total: allocation.holdingTank,
    vineyard_total: allocation.vineyard, storehouse_reserves: allocation.reserves,
  };
}

export const allocationSummary = (a: Allocation) => ({
  notes: a.notes, income_funds_moved: a.incomeFundsMoved, income_funds_on_file: a.incomeFundsOnFile,
  cash_value_added: a.cashValueAdded, real_estate_added: a.realEstateAdded, credit_capacity: a.creditCapacity, credit_lines: a.creditLines,
});
