// How the Sovereignty Review presents Capital & Asset Protection. Pure; no I/O.
//
//  - Income funds (from the investment statements) count as Liquidity Reserve when the household has no
//    Liquidity Reserve set up (no Liquidity storehouse, or one with no target). They come out of the
//    Vineyard / Holding Tank account they sit in; equity funds stay where they are, so AUM doesn't change.
//  - Insurance cash value that isn't already booked against a storehouse counts as Strategic Reserve (unless the policy's
//    "count in Strategic Reserve" switch is off).
//    This is an asset the AUM total did not include, so AUM and net worth rise by it.
//  - Real estate held in a Storehouse (principal residence, investment property) counts in its reserve
//    (normally Legacy Trust). The shared diagnostics leave it out of AUM, but a balance sheet needs it, so the
//    review adds it to the reserve, Total Assets and Net Worth.
//  - Harvest to date = the total of ALL withdrawals taken from ALL accounts (every fund), as read from the
//    statements. Null when no account has had its withdrawals read yet (unknown, not zero).

export interface AllocAccount {
  bucket: "vineyard" | "holding_tank";
  current_value: number | null;
  income_funds_value: number | null;
  withdrawals_ytd: number | null; // net withdrawals this year, read from the statement
  /** False for accounts that don't issue a statement (e.g. a GIC with no account number): never counted as 'still to read'. */
  expects_statement?: boolean;
  /** Date of the statement the figures were read from (YYYY-MM-DD), when known. */
  as_of?: string | null;
}

/** A liability row, as far as the Strategic Reserve's available-credit rule needs it. */
export interface CreditLine {
  description?: string | null;
  liability_type: string;
  credit_limit: number | string | null;
  current_balance: number | string | null;
  credit_in_strategic?: boolean | null;
}
const REVOLVING = new Set(["heloc", "credit_card", "line_of_credit"]);

/**
 * Unused credit staff have assigned to the Strategic Reserve: credit limit less balance on each flagged revolving line
 * (never below zero). It is counted in the Strategic Reserve and in Total Assets, with an equal "undrawn credit" line on
 * the liabilities side, so Net Worth is unchanged and the balance sheet still balances.
 */
export function creditForStrategic(lines: CreditLine[] | undefined): { total: number; lines: { description: string; available: number }[] } {
  const out: { description: string; available: number }[] = [];
  for (const l of lines ?? []) {
    if (!l.credit_in_strategic || !REVOLVING.has(l.liability_type)) continue;
    const limit = Number(l.credit_limit), bal = Number(l.current_balance) || 0;
    if (!Number.isFinite(limit) || limit <= 0) continue;
    const available = Math.max(0, Math.round((limit - bal) * 100) / 100);
    if (available > 0) out.push({ description: String(l.description ?? "Credit line"), available });
  }
  return { total: Math.round(out.reduce((a, x) => a + x.available, 0) * 100) / 100, lines: out };
}

export interface AllocInput {
  aum: number;
  netWorth: number;
  holdingTank: number;
  vineyard: number;
  reserves: { liquidity: number; strategic: number; philanthropic: number; legacy: number };
  liquidityStorehouse: { exists: boolean; target: number | null };
  accounts: AllocAccount[];
  policies: { cash_value: number | null; cash_value_storehouse_id: string | null; cv_in_strategic?: boolean | null }[];
  /** Real-estate Storehouse rows the shared diagnostics exclude, by the reserve they belong to. */
  realEstate?: { liquidity?: number; strategic?: number; philanthropic?: number; legacy?: number };
  /** The household's personal liabilities, for credit assigned to the Strategic Reserve. */
  credit?: CreditLine[];
  /** Other assets (principal residence, vehicles...), each counted once at full value in the Legacy Trust. */
  otherAssets?: OtherAssetLine[];
  /** Today (YYYY-MM-DD), for the stale-value check; defaults to the current date. */
  today?: string;
}

export interface OtherAssetLine { name: string; category?: string | null; value: number | string | null; as_of?: string | null }

/** Other assets whose value is missing a date or is more than 12 months old. */
export function staleOtherAssets(items: OtherAssetLine[], today: string = new Date().toISOString().slice(0, 10)): OtherAssetLine[] {
  const cutoff = new Date(today); cutoff.setFullYear(cutoff.getFullYear() - 1);
  return items.filter((a) => {
    if (!(Number(a.value) > 0)) return false;
    const d = a.as_of ? new Date(a.as_of) : null;
    return !d || Number.isNaN(d.getTime()) || d < cutoff;
  });
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
  realEstateAdded: number;        // real estate and other assets counted in the reserves (and in assets / net worth)
  otherAssetsAdded: number;       // the part of realEstateAdded that comes from Other Assets (residence, vehicles...)
  creditCapacity: number;         // available credit assigned to the Strategic Reserve: in the reserve and Total Assets, offset by an equal undrawn-credit liability (Net Worth unchanged)
  creditLines: { description: string; available: number }[];
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
    .filter((p) => !p.cash_value_storehouse_id && p.cv_in_strategic !== false && isNum(p.cash_value) && p.cash_value > 0)
    .reduce((s, p) => s + (p.cash_value as number), 0));
  if (cashValueAdded > 0) {
    reserves.strategic += cashValueAdded;
    notes.push(`Strategic Reserve includes ${money(cashValueAdded)} of insurance cash value.`);
  }

  // Real estate rows the shared totals left out.
  const re = i.realEstate ?? {};
  const otherItems = (i.otherAssets ?? []).filter((a) => Number(a.value) > 0);
  const otherAssetsAdded = round2(otherItems.reduce((t, a) => t + Number(a.value), 0));
  const realEstateAdded = round2(num(re.liquidity) + num(re.strategic) + num(re.philanthropic) + num(re.legacy) + otherAssetsAdded);
  if (realEstateAdded > 0) {
    reserves.liquidity += num(re.liquidity);
    reserves.strategic += num(re.strategic);
    reserves.philanthropic += num(re.philanthropic);
    reserves.legacy += num(re.legacy);
    if (num(re.legacy) > 0) notes.push(`Legacy Trust includes ${money(num(re.legacy))} of real estate (principal residence and investment property).`);
    if (otherAssetsAdded > 0) {
      reserves.legacy += otherAssetsAdded;
      notes.push(`Legacy Trust includes ${money(otherAssetsAdded)} of other assets (${otherItems.map((a) => a.name).join(", ")}).`);
      const stale = staleOtherAssets(otherItems, i.today);
      if (stale.length) notes.push(`Update the value of ${stale.map((a) => a.name).join(", ")}: not confirmed in the last 12 months.`);
    }
  }

  // Available credit assigned to the Strategic Reserve: an asset in the reserve and Total Assets, offset by an equal
  // undrawn-credit liability, so Net Worth does not move.
  const credit = creditForStrategic(i.credit);
  if (credit.total > 0) {
    reserves.strategic += credit.total;
    notes.push(`Strategic Reserve includes ${money(credit.total)} of available credit, offset by an equal undrawn-credit line in liabilities (Net Worth is unchanged).`);
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
    aum: round2(i.aum + cashValueAdded + realEstateAdded + credit.total),
    netWorth: round2(i.netWorth + cashValueAdded + realEstateAdded),
    holdingTank: round2(holdingTank),
    vineyard: round2(vineyard),
    reserves: {
      liquidity: round2(reserves.liquidity), strategic: round2(reserves.strategic),
      philanthropic: round2(reserves.philanthropic), legacy: round2(reserves.legacy),
    },
    incomeFundsMoved, incomeFundsOnFile, cashValueAdded, realEstateAdded, otherAssetsAdded, creditCapacity: credit.total, creditLines: credit.lines, totalWithdrawals,
    accountsWithWithdrawalData: withData.length, harvest, notes,
  };
}
