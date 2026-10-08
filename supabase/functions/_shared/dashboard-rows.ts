// The Vineyard dashboard's per-account rows: start-of-year (BOY) and current value, withdrawals so far this year and the
// growth that is left once withdrawals are added back. Pure: no I/O.

export interface DashRow {
  id: string;
  group: "holding_tank" | "vineyard" | "storehouse";
  owner: string;
  name: string;
  accountType: string | null;
  last4: string | null;
  boy: number | null;
  boySource: "snapshot" | null;
  current: number | null;
  withdrawalsYtd: number | null;
  /** Current + withdrawals - BOY: how the money did before anything was taken out. null when BOY or current is missing. */
  growth: number | null;
  change: number | null;
  changePct: number | null;
  asOf: string | null;
}

const num = (v: unknown): number | null => (v === null || v === undefined || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function dashRow(r: { id: string; group: DashRow["group"]; owner: string; name: string; accountType?: string | null; accountNumber?: string | null; boy?: unknown; current?: unknown; withdrawalsYtd?: unknown; asOf?: string | null }): DashRow {
  const boy = num(r.boy), current = num(r.current), w = num(r.withdrawalsYtd);
  const digits = String(r.accountNumber ?? "").replace(/\D/g, "");
  const change = boy !== null && current !== null ? round2(current - boy) : null;
  return {
    id: r.id, group: r.group, owner: r.owner, name: r.name, accountType: r.accountType ?? null, last4: digits.length >= 4 ? digits.slice(-4) : null,
    boy, boySource: boy !== null ? "snapshot" : null, current, withdrawalsYtd: w,
    change, changePct: change !== null && boy ? round2((change / boy) * 100) : null,
    growth: boy !== null && current !== null ? round2(current + (w ?? 0) - boy) : null,
    asOf: r.asOf ?? null,
  };
}

export interface DashTotals { boy: number; current: number; withdrawals: number; growth: number; change: number; changePct: number | null; withBoy: number; withoutBoy: number }

/** Totals over the rows. BOY, change and growth only count rows that have a BOY, so a missing BOY never looks like growth. */
export function dashTotals(rows: DashRow[]): DashTotals {
  const have = rows.filter((r) => r.boy !== null && r.current !== null);
  const boy = have.reduce((a, r) => a + (r.boy ?? 0), 0);
  const currentHave = have.reduce((a, r) => a + (r.current ?? 0), 0);
  return {
    boy: round2(boy), current: round2(rows.reduce((a, r) => a + (r.current ?? 0), 0)),
    withdrawals: round2(rows.reduce((a, r) => a + (r.withdrawalsYtd ?? 0), 0)),
    growth: round2(have.reduce((a, r) => a + (r.growth ?? 0), 0)), change: round2(currentHave - boy),
    changePct: boy > 0 ? round2(((currentHave - boy) / boy) * 100) : null,
    withBoy: have.length, withoutBoy: rows.length - have.length,
  };
}

/** The newest snapshot row per account key. */
export function latestSnapshots<T extends { snapshot_date: string | null }>(rows: T[], keyOf: (r: T) => string | null): Map<string, T> {
  const out = new Map<string, T>();
  for (const r of rows) {
    const k = keyOf(r);
    if (!k) continue;
    const prev = out.get(k);
    if (!prev || (r.snapshot_date ?? "") > (prev.snapshot_date ?? "")) out.set(k, r);
  }
  return out;
}
