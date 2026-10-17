import { describe, it, expect } from "vitest";
import { dateFromFileName, parsePerformanceGrid } from "../../supabase/functions/_shared/performance-file-parse";
import { firstBusinessDay, reminderFor, fileChecks } from "../../supabase/functions/_shared/monthly-import-checks";

describe("reading the monthly performance file", () => {
  it("takes the date from the file name", () => {
    expect(dateFromFileName("Tracking_Performance_20260529_074_W79.xlsx")).toBe("2026-05-29");
    expect(dateFromFileName("report.xlsx")).toBeNull();
    expect(dateFromFileName("Tracking_20261340.xlsx")).toBeNull();
  });
  const grid = [
    ["Tracking performance", null, null],
    ["Last Name", "First Name", "Contract Number", "Product", "Type of Registration", "Begining of the Year", "As of 2026-09-30", "Year-to-Date", "Since Initial Purchase"],
    ["Nieswandt", "Dana", "1819099134", "IAG", "RRSP", 1048.43, 1117.03, 0.0612, 0.4],
    ["Nieswandt", "Steffen", "1819106165", "IAG", "RRSP", "Information for this account not available", 54702.63, 0.12, null],
    [null, null, null, null, null, null, null, null, null],
    ["Total", null, "n/a", null, null, null, 1, null, null],
  ];
  it("finds the header, reads the balances, and drops totals and text balances", () => {
    const r = parsePerformanceGrid(grid, "Tracking_Performance_20260930_1.xlsx");
    expect(r.snapshotDate).toBe("2026-09-30");
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]).toMatchObject({ contract: "1819099134", last_name: "Nieswandt", registration: "RRSP", boy_value: 1048.43, current_value: 1117.03, ror_ytd: 0.0612, ror_since_inception: 0.4 });
    expect(r.rows[1].boy_value).toBeNull(); // text, not a balance
  });
  it("falls back to the As of column for the date, and says so when there is no header", () => {
    expect(parsePerformanceGrid(grid, "x.xlsx").snapshotDate).toBe("2026-09-30");
    expect(parsePerformanceGrid([["nothing here"]], "x.xlsx").error).toMatch(/header row/);
  });
});

describe("when the file is due", () => {
  it("is the first weekday of the month", () => {
    expect(firstBusinessDay("2026-11-18")).toBe("2026-11-02"); // 1 Nov 2026 is a Sunday
    expect(firstBusinessDay("2026-10-17")).toBe("2026-10-01");
    expect(firstBusinessDay("2027-05-20")).toBe("2027-05-03"); // 1 May 2027 is a Saturday
  });
  it("asks once on the first business day, again as late from the third, and stops when the file is here", () => {
    const none = { download: false, late: false };
    expect(reminderFor("2026-10-30", false, none).kind).toBe("download"); // already past the first business day with nothing sent
    expect(reminderFor("2026-11-02", false, none).kind).toBe("download");
    expect(reminderFor("2026-11-02", false, { download: true, late: false }).kind).toBeNull();
    expect(reminderFor("2026-11-04", false, { download: true, late: false }).kind).toBe("late"); // Mon 2, Tue 3, Wed 4
    expect(reminderFor("2026-11-04", false, { download: true, late: true }).kind).toBeNull();
    expect(reminderFor("2026-11-02", true, none).kind).toBeNull();
    expect(reminderFor("2026-11-01", false, none).kind).toBeNull(); // Sunday, before the first business day
  });
});

describe("is a whole file safe to import by itself", () => {
  const last = { snapshotDate: "2026-08-31", rowCount: 100, totalValue: 5_000_000 };
  const ok = { snapshotDate: "2026-09-30", rowCount: 102, totalValue: 5_050_000, duplicateContracts: 0 };
  it("passes a normal month", () => { expect(fileChecks(ok, last, "2026-10-01")).toEqual({ ok: true, problems: [] }); });
  it("holds a file that is old, mid-month, in the future, empty or duplicated", () => {
    expect(fileChecks({ ...ok, snapshotDate: "2026-08-31" }, last, "2026-10-01").problems[0]).toMatch(/already imported/);
    expect(fileChecks({ ...ok, snapshotDate: "2026-09-12" }, last, "2026-10-01").problems.join()).toMatch(/not near a month-end/);
    expect(fileChecks({ ...ok, snapshotDate: "2027-09-30" }, last, "2026-10-01").problems.join()).toMatch(/future/);
    expect(fileChecks({ ...ok, rowCount: 0 }, last, "2026-10-01").problems.join()).toMatch(/no account rows/);
    expect(fileChecks({ ...ok, duplicateContracts: 2 }, last, "2026-10-01").problems.join()).toMatch(/2 contract numbers/);
  });
  it("holds a file whose size or total differs by more than 15% from last month's", () => {
    expect(fileChecks({ ...ok, rowCount: 60 }, last, "2026-10-01").ok).toBe(false);
    expect(fileChecks({ ...ok, totalValue: 3_000_000 }, last, "2026-10-01").problems.join()).toMatch(/40% different/);
  });
  it("has nothing to compare with on the first ever import", () => { expect(fileChecks(ok, null, "2026-10-01").ok).toBe(true); });
});
