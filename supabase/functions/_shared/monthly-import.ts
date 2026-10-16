// monthly-import.ts: the checks behind the monthly performance import (iA export plus hand-added JustWealth rows).
// Pure (no I/O) so it can be unit-tested. The import writes a monthly snapshot and the account's current value; these
// rules decide which rows are routine, which need a person, and what is missing from the file.

export const MANAGED_CUSTODIANS = ["iA Financial Group", "JustWealth"];
/** A value moving more than this fraction from last month goes to the exceptions list. */
export const CHANGE_THRESHOLD = 0.25;

export type ChangeVerdict = { exception: false; changePct: number | null } | { exception: true; changePct: number | null; reason: string };

/** Month-over-month change as a percentage, or null when there is no usable previous value. */
export function changePct(prev: number | null, next: number | null): number | null {
  if (prev === null || next === null || !Number.isFinite(prev) || !Number.isFinite(next) || prev <= 0) return null;
  return ((next - prev) / prev) * 100;
}

/** Is this new value routine, or does it need a person's eye? The first value for an account is never an exception. */
export function classifyChange(prev: number | null, next: number | null, threshold = CHANGE_THRESHOLD): ChangeVerdict {
  const pct = changePct(prev, next);
  if (next !== null && Number.isFinite(next) && next < 0) return { exception: true, changePct: pct, reason: "negative value" };
  if (prev !== null && prev > 0 && next === 0) return { exception: true, changePct: pct, reason: "dropped to zero" };
  if (pct !== null && Math.abs(pct) / 100 > threshold) {
    return { exception: true, changePct: pct, reason: `${pct > 0 ? "up" : "down"} ${Math.abs(pct).toFixed(1)}% from last month` };
  }
  return { exception: false, changePct: pct };
}

/**
 * The beginning-of-year value to store. A row with none (JustWealth, or iA's "information not available") must not
 * overwrite the book value with 0 or treat the whole balance as this year's gain: carry forward what we already had.
 */
export function resolveBoy(i: { rowBoy: number | null; sameYearSnapshotBoy: number | null; accountBook: number | null; current: number }): number {
  if (i.rowBoy !== null && Number.isFinite(i.rowBoy)) return i.rowBoy;
  if (i.sameYearSnapshotBoy !== null && Number.isFinite(i.sameYearSnapshotBoy)) return i.sameYearSnapshotBoy;
  if (i.accountBook !== null && Number.isFinite(i.accountBook) && i.accountBook > 0) return i.accountBook;
  return i.current;
}

export function yearToDatePct(boy: number, current: number): number {
  return boy > 0 ? ((current - boy) / boy) * 100 : 0;
}

/** "justwealth" / "JustWealth Inc." -> the canonical name; anything else is kept as typed; empty -> null. */
export function normalizeCustodian(raw: string | null | undefined): string | null {
  const t = String(raw ?? "").trim();
  if (!t) return null;
  const k = t.toLowerCase().replace(/[^a-z]/g, "");
  if (k.includes("justwealth")) return "JustWealth";
  if (k === "ia" || k.startsWith("iafinancial") || k.startsWith("industrialalliance")) return "iA Financial Group";
  return t;
}

const isoOk = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

/** Warnings about the file's date: a future date, a date older than what is already imported, a re-import, a non-month-end date. */
export function monthCheck(snapshotDate: string, latestImported: string | null, today: Date): string[] {
  if (!isoOk(snapshotDate)) return ["The snapshot date is not a valid date."];
  const out: string[] = [];
  if (Date.parse(snapshotDate) > today.getTime()) out.push(`The date ${snapshotDate} is in the future.`);
  if (latestImported && snapshotDate < latestImported) out.push(`Newer data is already imported (${latestImported}). This file is older.`);
  if (latestImported && snapshotDate === latestImported) out.push(`${snapshotDate} was already imported. Committing again will update those snapshots, not duplicate them.`);
  const d = new Date(`${snapshotDate}T00:00:00Z`);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  if (d.getUTCDate() !== lastDay) out.push(`${snapshotDate} is not the last day of a month. Statements and the performance export are usually dated month-end.`);
  return out;
}

/** The snapshot that records an account as closed at a month-end: a zero balance, so history, totals and the pack all agree. */
export function closeSnapshotRow(i: { contactId: string; holdingTankId?: string | null; vineyardAccountId?: string | null; snapshotDate: string; boy: number; userId?: string | null }) {
  return {
    contact_id: i.contactId, holding_tank_id: i.holdingTankId ?? null, vineyard_account_id: i.vineyardAccountId ?? null,
    snapshot_date: i.snapshotDate, reporting_year: Number(i.snapshotDate.slice(0, 4)),
    boy_value: i.boy, current_value: 0, ytd_value: 0, current_harvest: 0,
    notes: `Account closed: not in the ${i.snapshotDate} monthly file. Balance set to zero.`, created_by: i.userId ?? null,
  };
}

export interface ExpectedAccount { id: string; table: string; accountNumber: string; custodian: string | null; label: string; owner: string }

/** Managed accounts that are in the system but not in the file (their contract numbers compared as text). */
export function missingFromFile(expected: ExpectedAccount[], fileContracts: Iterable<string>): ExpectedAccount[] {
  const seen = new Set([...fileContracts].map((c) => String(c).trim()));
  return expected.filter((a) => a.accountNumber && MANAGED_CUSTODIANS.includes(a.custodian ?? "") && !seen.has(String(a.accountNumber).trim()));
}

/** The second and later rows for a contract number already seen in the file. */
export function duplicateContracts(contracts: string[]): Set<string> {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const c of contracts) { if (seen.has(c)) dup.add(c); seen.add(c); }
  return dup;
}
