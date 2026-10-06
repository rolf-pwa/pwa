// How the Sovereignty Review presents Capital & Asset Protection. Pure; no I/O.
//
//  - Income funds (from the investment statements) count as Liquidity Reserve when the household has no
//    Liquidity Reserve set up (no Liquidity storehouse, or one with no target). They come out of the
//    Vineyard / Holding Tank account they sit in; equity funds stay where they are, so AUM doesn't change.
//  - Insurance cash value that isn't already booked against a storehouse counts as Strategic Reserve.
//    This is an asset the AUM total did not include, so AUM and net worth rise by it.
//  - Harvest to date = the total of ALL withdrawals taken from ALL accounts (every fund), as read from the
//    statements. Null when no account has had its withdrawals read yet (unknown, not zero).

export interface AllocAccount {
  bucket: "vineyard" | "holding_tank";
  current_value: number | null;
  income_funds_value: number | null;
  withdrawals_ytd: number | null; // net withdrawals this year, read from the statement
  /** False for accounts that don't issue a statement (e.g. a GIC with no account number): never counted as 'still to read'. */
  expects_statement?: boolean;
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
  totalWithdrawals: number;       // all withdrawals read from statements
  accountsWithWithdrawalData: number;
  harvest: number | null;         // = totalWithdrawals when any account has data, else null
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

  // Only accounts that issue a statement can be "read"; the rest are left out of the counts and notes.
  const expecting = i.accounts.filter((a) => a.expects_statement !== false);
  const withData = expecting.filter((a) => isNum(a.withdrawals_ytd));
  const totalWithdrawals = round2(withData.reduce((s, a) => s + (a.withdrawals_ytd as number), 0));
  const harvest = withData.length > 0 ? totalWithdrawals : null;
  if (expecting.length > 0 && withData.length === 0) {
    notes.push("Harvest to date needs the statements' withdrawals: run a Vault scan to read them.");
  } else if (expecting.length > 0 && withData.length < expecting.length) {
    notes.push(`Harvest counts withdrawals from ${withData.length} of ${expecting.length} accounts with statements; run a Vault scan to read the rest.`);
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
    incomeFundsMoved, incomeFundsOnFile, cashValueAdded, totalWithdrawals,
    accountsWithWithdrawalData: withData.length, harvest, notes,
  };
}
