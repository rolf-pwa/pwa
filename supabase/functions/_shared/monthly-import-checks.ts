// monthly-import-checks.ts: when the monthly file is due, and whether a file looks safe to import by itself. Pure (no I/O).

const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (s: string, n: number) => iso(new Date(Date.parse(`${s}T00:00:00Z`) + n * 86_400_000));
const dow = (s: string) => new Date(`${s}T00:00:00Z`).getUTCDay(); // 0 Sunday

/** The first weekday of the month containing `date` (Pacific business day; holidays are not known, so a holiday shifts it by a day at most in practice). */
export function firstBusinessDay(date: string): string {
  let d = `${date.slice(0, 7)}-01`;
  while (dow(d) === 0 || dow(d) === 6) d = addDays(d, 1);
  return d;
}

export interface Reminder { kind: "download" | "late" | null; reason: string }
/**
 * What Georgia should say today about this month's file: "download" from the first business day (once), then "late" from the third
 * business day (once) if no file has been dropped in the folder. `haveFileThisMonth` is true once this month's file has been seen.
 */
export function reminderFor(today: string, haveFileThisMonth: boolean, alreadySent: { download: boolean; late: boolean }): Reminder {
  if (haveFileThisMonth) return { kind: null, reason: "the file is already here" };
  const first = firstBusinessDay(today);
  if (today < first) return { kind: null, reason: "before the first business day" };
  if (!alreadySent.download) return { kind: "download", reason: "time to download this month's file" };
  let third = first; let n = 0;
  while (n < 2) { third = addDays(third, 1); if (dow(third) !== 0 && dow(third) !== 6) n++; }
  if (today >= third && !alreadySent.late) return { kind: "late", reason: "no file by the third business day" };
  return { kind: null, reason: "nothing due" };
}

export interface FileFacts { snapshotDate: string | null; rowCount: number; totalValue: number; duplicateContracts: number }
export interface LastImport { snapshotDate: string; rowCount: number; totalValue: number }
export interface FileVerdict { ok: boolean; problems: string[] }

/** Is this whole file safe to commit without a person looking? Any problem holds the file for Rolf. */
export function fileChecks(f: FileFacts, last: LastImport | null, today: string, tolerancePct = 15): FileVerdict {
  const problems: string[] = [];
  if (!f.snapshotDate || !/^\d{4}-\d{2}-\d{2}$/.test(f.snapshotDate)) problems.push("The file has no readable date.");
  else {
    if (f.snapshotDate > today) problems.push(`The file's date (${f.snapshotDate}) is in the future.`);
    if (last && f.snapshotDate <= last.snapshotDate) problems.push(`Newer data is already imported (${last.snapshotDate}); this file is dated ${f.snapshotDate}.`);
    // A month's file is dated near the end of the month: from the 20th on.
    if (Number(f.snapshotDate.slice(8, 10)) < 20) problems.push(`The file's date (${f.snapshotDate}) is not near a month-end.`);
  }
  if (f.rowCount === 0) problems.push("The file has no account rows.");
  if (f.duplicateContracts > 0) problems.push(`${f.duplicateContracts} contract number${f.duplicateContracts === 1 ? "" : "s"} appear more than once.`);
  if (last && last.rowCount > 0 && f.rowCount > 0) {
    const d = Math.abs(f.rowCount - last.rowCount) / last.rowCount * 100;
    if (d > tolerancePct) problems.push(`${f.rowCount} accounts against ${last.rowCount} last month (${Math.round(d)}% different).`);
  }
  if (last && last.totalValue > 0 && f.totalValue > 0) {
    const d = Math.abs(f.totalValue - last.totalValue) / last.totalValue * 100;
    if (d > tolerancePct) problems.push(`Total value is ${Math.round(d)}% different from last month.`);
  }
  return { ok: problems.length === 0, problems };
}
