// performance-file-parse.ts: turns iA's monthly performance export (already read into a grid of cells) into the rows the importer takes.
// Pure (no spreadsheet library, no I/O), so the browser upload and Georgia's folder watcher read the file the same way.

export interface PerfFileRow {
  contract: string; last_name?: string; first_name?: string; product?: string; registration?: string; custodian?: string | null;
  issue_date?: string | null; boy_value?: number | null; current_value?: number | null; variation_pct?: number | null; variation_dollar?: number | null;
  ror_ytd?: number | null; ror_6m?: number | null; ror_1y?: number | null; ror_3y?: number | null; ror_5y?: number | null; ror_since_inception?: number | null;
}

export const HEADER_MAP: Record<string, keyof PerfFileRow> = {
  "last name": "last_name", "first name": "first_name", "contract number": "contract", "product": "product",
  "type of registration": "registration", "account type": "registration", "account number": "contract", "custodian": "custodian",
  "issue date": "issue_date", "begining of the year": "boy_value", "beginning of the year": "boy_value",
  "%": "variation_pct", "$": "variation_dollar", "year-to-date": "ror_ytd", "6 months": "ror_6m", "1 year": "ror_1y", "3 years": "ror_3y", "5 years": "ror_5y",
};

/** The date in a file name like Tracking_Performance_20260529_074_W79.xlsx, as YYYY-MM-DD. */
export function dateFromFileName(name: string): string | null {
  const m = String(name ?? "").match(/(\d{4})(\d{2})(\d{2})/);
  if (!m) return null;
  const iso = `${m[1]}-${m[2]}-${m[3]}`;
  const d = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso ? iso : null;
}

export interface ParsedPerformanceFile { rows: PerfFileRow[]; snapshotDate: string | null; error?: string }

/** `grid` is the first sheet as rows of cells (dates may be Date objects). The snapshot date comes from the file name, else from an "As of YYYY-MM-DD" column. */
export function parsePerformanceGrid(grid: unknown[][], fileName = ""): ParsedPerformanceFile {
  let snapshotDate = dateFromFileName(fileName);
  let headerIdx = -1;
  for (let i = 0; i < Math.min(grid.length, 20); i++) {
    if ((grid[i] ?? []).some((c) => String(c ?? "").toLowerCase().includes("contract number"))) { headerIdx = i; break; }
  }
  if (headerIdx < 0) return { rows: [], snapshotDate, error: "Couldn't find the header row (a column called Contract Number)." };
  const headers = (grid[headerIdx] ?? []).map((c) => String(c ?? "").toLowerCase().trim());
  const asOfIdx = headers.findIndex((h) => h.startsWith("as of"));
  const asOf = asOfIdx >= 0 ? headers[asOfIdx].match(/(\d{4})-(\d{2})-(\d{2})/) : null;
  if (!snapshotDate && asOf) snapshotDate = `${asOf[1]}-${asOf[2]}-${asOf[3]}`;
  const sinceIdx = headers.findIndex((h) => h.startsWith("since"));

  const rows: PerfFileRow[] = [];
  for (let i = headerIdx + 1; i < grid.length; i++) {
    const cells = grid[i] ?? [];
    if (!cells.some((c) => c !== null && c !== undefined && c !== "")) continue;
    // deno-lint-ignore no-explicit-any
    const obj: any = {};
    headers.forEach((h, j) => { const key = HEADER_MAP[h]; if (key) obj[key] = cells[j]; });
    if (asOfIdx >= 0) obj.current_value = cells[asOfIdx];
    if (sinceIdx >= 0) obj.ror_since_inception = cells[sinceIdx];
    const contract = String(obj.contract ?? "").trim();
    if (!contract || !/^\d+$/.test(contract)) continue;
    obj.contract = contract;
    // A balance printed as text ("Information for this account not available") is no balance.
    if (typeof obj.boy_value === "string") obj.boy_value = null;
    if (typeof obj.current_value === "string") obj.current_value = null;
    if (obj.issue_date instanceof Date) obj.issue_date = obj.issue_date.toISOString().slice(0, 10);
    rows.push(obj);
  }
  return { rows, snapshotDate };
}
