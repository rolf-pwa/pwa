// How the Sovereignty Review presents Capital & Asset Protection. Pure; no I/O.
//
//  - Income funds (from the investment statements) count as Liquidity Reserve when the household has no
//    Liquidity Reserve set up (no Liquidity storehouse, or one with no target). They come out of the
//    Vineyard / Holding Tank account they sit in; equity funds stay where they are, so AUM doesn't change.
//  - Insurance cash value that isn't already booked against a storehouse counts as Strategic Reserve.
//    This is an asset the AUM total did not include, so AUM and net worth rise by it.
//  - Harvest to date = growth since the beginning of the year (current value - opening value, from the
//    harvest snapshots) + withdrawals taken from income funds, because those withdrawals reduced the
//    balance but were still harvested.

export interface AllocAccount {
  bucket: "vineyard" | "holding_tank";
  current_value: number | null;
  income_funds_value: number | null;
  income_withdrawals_ytd: number | null;
}

export interface AllocInput {
  aum: number;
  netWorth: number;
  holdingTank: number;
  vineyard: number;
  reserves: { liquidity: number; strategic: number; philanthropic: number; legacy: number };
  liquidityStorehouse: { exists: boolean; target: number | null };
  accounts: AllocAccount[];
  policies: { cash_value: number | null; cash_value_storehouse_id: string | null }[];
  /** Sum of year-to-date harvest (net growth) across tracked accounts, from the harvest snapshots. */
  snapshotHarvest: number;
}

export interface Allocation {
  aum: number;
  netWorth: number;
  holdingTank: number;
  vineyard: number;
  reserves: { liquidity: number; strategic: number; philanthropic: number; legacy: number };
  incomeFundsMoved: number;       // income funds counted as Liquidity (0 when a Liquidity Reserve is set up)
  incomeFundsOnFile: number;      // income funds known from statements, moved or not
  cashValueAdded: number;         // policy cash value counted as Strategic
  incomeWithdrawals: number;      // withdrawals from income funds read from statements
  accountsWithWithdrawalData: number;
  harvest: number;                // snapshot harvest + income withdrawals
  notes: string[];
}

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const round2 = (n: number) => Math.round(n * 100) / 100;
const money = (n: number) => `$${Math.round(n).toLocaleString("en-CA")}`;

/** A Liquidity Reserve is "set up" when a Liquidity storehouse exists and has a target. */
export const hasLiquidityReserve = (s: { exists: boolean; target: number | null }) => s.exists && num(s.target) > 0;

export function allocateCapital(i: AllocInput): Allocation {
  const notes: string[] = [];
  let holdingTank = i.holdingTank;
  let vineyard = i.vineyard;
  const reserves = { ...i.reserves };

  // Income funds, capped at the account's value so a bad figure can't push a bucket negative.
  const perAccount = i.accounts.map((a) => ({
    bucket: a.bucket,
    income: isNum(a.income_funds_value) && a.income_funds_value > 0
      ? Math.min(a.income_funds_value, Math.max(0, num(a.current_value)) || a.income_funds_value) : 0,
  }));
  const incomeFundsOnFile = round2(perAccount.reduce((s, a) => s + a.income, 0));
  let incomeFundsMoved = 0;
  if (!hasLiquidityReserve(i.liquidityStorehouse) && incomeFundsOnFile > 0) {
    incomeFundsMoved = incomeFundsOnFile;
    for (const a of perAccount) {
      if (a.bucket === "vineyard") vineyard -= a.income; else holdingTank -= a.income;
    }
    reserves.liquidity += incomeFundsMoved;
    notes.push(`Liquidity Reserve includes ${money(incomeFundsMoved)} of income funds from the investment statements.`);
  }

  // Insurance cash value not already booked against a storehouse -> Strategic Reserve (new to the total).
  const cashValueAdded = round2(i.policies
    .filter((p) => !p.cash_value_storehouse_id && isNum(p.cash_value) && p.cash_value > 0)
    .reduce((s, p) => s + (p.cash_value as number), 0));
  if (cashValueAdded > 0) {
    reserves.strategic += cashValueAdded;
    notes.push(`Strategic Reserve includes ${money(cashValueAdded)} of insurance cash value.`);
  }

  const withData = i.accounts.filter((a) => isNum(a.income_withdrawals_ytd));
  const incomeWithdrawals = round2(withData.reduce((s, a) => s + (a.income_withdrawals_ytd as number), 0));
  const harvest = round2(i.snapshotHarvest + incomeWithdrawals);
  if (incomeWithdrawals > 0) notes.push(`Harvest includes ${money(incomeWithdrawals)} withdrawn from income funds.`);
  if (i.accounts.length > 0 && withData.length < i.accounts.length) {
    notes.push(`Income-fund withdrawals are known for ${withData.length} of ${i.accounts.length} accounts; run a Vault scan to read the rest.`);
  }

  return {
    aum: round2(i.aum + cashValueAdded),
    netWorth: round2(i.netWorth + cashValueAdded),
    holdingTank: round2(holdingTank),
    vineyard: round2(vineyard),
    reserves: {
      liquidity: round2(reserves.liquidity), strategic: round2(reserves.strategic),
      philanthropic: round2(reserves.philanthropic), legacy: round2(reserves.legacy),
    },
    incomeFundsMoved, incomeFundsOnFile, cashValueAdded, incomeWithdrawals,
    accountsWithWithdrawalData: withData.length, harvest, notes,
  };
}
