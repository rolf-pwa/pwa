// vfo-liquidity.ts: the Liquidity Reserve as the family sees it in the VFO portal. Pure; no I/O.
//
// It is the staff balance sheet's rule (quarterly-review-allocation.ts), applied to the accounts the viewer can see: when the household has no
// Liquidity Reserve set up (no Liquidity storehouse, or one with no target), the income funds held in the investment accounts count as Liquidity.
// They stay inside the Vineyard account they sit in, so nothing is added to the totals: this is a view of money already in the Vineyard.
// Income funds are only known for accounts whose statements have been read, so the view says how many of the accounts it covers instead of
// presenting a total that looks complete. What could be drawn this year is NOT worked out here: it is the starting Liquidity Reserve less
// withdrawals this year, up to the Charter's amount, and that is added once its inputs are settled.

import { hasLiquidityReserve } from "./quarterly-review-allocation.ts";

export interface LiquidityAccount {
  id: string;
  account_name?: string | null;
  account_number?: string | null;
  account_type?: string | null;
  current_value?: number | string | null;
  /** The value at the start of the year (the CRM's book value). */
  book_value?: number | string | null;
  income_funds_value?: number | string | null;
  income_funds_as_of?: string | null;
}

export interface LiquidityStorehouse {
  storehouse_number: number;
  current_value?: number | string | null;
  target_value?: number | string | null;
}

export interface LiquidityLine {
  id: string;
  name: string;
  last4: string | null;
  accountType: string | null;
  incomeFunds: number;
  asOf: string | null;
}

export interface LiquidityView {
  /** True when the income funds are counted as the Liquidity Reserve (none is set up); false when the household's own Liquidity Reserve stands. */
  counted: boolean;
  storehouseLiquidity: number;
  incomeFunds: number;
  /** The reserve: the Liquidity storehouse plus the income funds when they are counted. */
  reserve: number;
  lines: LiquidityLine[];
  /** Accounts with their income funds read, and accounts that issue a statement at all. */
  covered: number;
  expected: number;
  asOf: string | null;
}

const toNum = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};
const round2 = (n: number) => Math.round(n * 100) / 100;
const last4 = (n: string | null | undefined) => {
  const d = String(n ?? "").replace(/\D/g, "");
  return d.length >= 4 ? d.slice(-4) : null;
};

export function liquidityView(accounts: LiquidityAccount[], storehouses: LiquidityStorehouse[]): LiquidityView {
  const liq = storehouses.filter((s) => s.storehouse_number === 1);
  const storehouseLiquidity = round2(liq.reduce((t, s) => t + (toNum(s.current_value) ?? 0), 0));
  const target = liq.reduce((t, s) => t + (toNum(s.target_value) ?? 0), 0);
  const setUp = hasLiquidityReserve({ exists: liq.length > 0, target: liq.length ? target : null });
  const none: LiquidityView = { counted: false, storehouseLiquidity, incomeFunds: 0, reserve: storehouseLiquidity, lines: [], covered: 0, expected: 0, asOf: null };
  if (setUp) return none;

  const expecting = accounts.filter((a) => !!String(a.account_number ?? "").trim());
  const lines: LiquidityLine[] = [];
  let covered = 0;
  for (const a of expecting) {
    const raw = toNum(a.income_funds_value);
    if (raw === null) continue;
    covered += 1;
    const current = toNum(a.current_value);
    // As the staff balance sheet does: capped at the account's value, so a bad figure cannot push a total up.
    const income = raw > 0 ? Math.min(raw, current !== null && current > 0 ? current : raw) : 0;
    if (income > 0) {
      lines.push({ id: a.id, name: a.account_name || "Account", last4: last4(a.account_number), accountType: a.account_type ?? null, incomeFunds: round2(income), asOf: a.income_funds_as_of ?? null });
    }
  }
  const incomeFunds = round2(lines.reduce((t, l) => t + l.incomeFunds, 0));
  const dates = expecting.map((a) => a.income_funds_as_of).filter((d): d is string => !!d).sort();
  return {
    counted: incomeFunds > 0,
    storehouseLiquidity, incomeFunds, reserve: round2(storehouseLiquidity + incomeFunds),
    lines: lines.sort((a, b) => b.incomeFunds - a.incomeFunds),
    covered, expected: expecting.length, asOf: dates.length ? dates[dates.length - 1] : null,
  };
}

/** The line shown with the reserve: how much of it is income funds, and how many accounts that covers. */
export function coverageText(v: Pick<LiquidityView, "covered" | "expected">): string | null {
  if (v.expected === 0) return null;
  return v.covered >= v.expected ? null : `Based on ${v.covered} of your ${v.expected} account${v.expected === 1 ? "" : "s"}: the rest are still being read.`;
}
