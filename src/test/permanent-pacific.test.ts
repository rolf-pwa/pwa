import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { pacificMonthStart } from "../../supabase/functions/_shared/bc-time";

const read = (p: string) => readFileSync(p, "utf8");

describe("the first instant of a month in Pacific time", () => {
  it("is -07:00 from the permanent date on, so November's start is 07:00 UTC, not 08:00", () => {
    expect(pacificMonthStart("2026-11")).toBe("2026-11-01T00:00:00-07:00");
    expect(pacificMonthStart("2026-12")).toBe("2026-12-01T00:00:00-07:00");
    expect(pacificMonthStart("2027-01")).toBe("2027-01-01T00:00:00-07:00");
    expect(new Date(pacificMonthStart("2027-02")).toISOString()).toBe("2027-02-01T07:00:00.000Z");
  });
  it("leaves earlier months as they were: -07:00 in summer, -08:00 in winter", () => {
    expect(pacificMonthStart("2026-07")).toBe("2026-07-01T00:00:00-07:00");
    expect(pacificMonthStart("2026-01")).toBe("2026-01-01T00:00:00-08:00");
    expect(pacificMonthStart("2025-12")).toBe("2025-12-01T00:00:00-08:00");
  });
});

describe("nothing still treats Pacific time as changing its clocks", () => {
  const sql = read("supabase/migrations/20270114120000_permanent_pacific_time.sql");
  const code = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  it("the database uses a fixed UTC-7 for the usage page's days and the monthly import task", () => {
    expect(code).not.toContain("America/Vancouver");
    expect(code.match(/Etc\/GMT\+7/g)!.length).toBe(4);
    expect(code).toContain("CREATE OR REPLACE FUNCTION public.ai_usage_summary");
    expect(code).toContain("CREATE OR REPLACE FUNCTION public.create_monthly_import_task");
    expect(code).toContain("extract(hour from now() at time zone 'Etc/GMT+7') = 4");
  });
  it("the monthly import reminder looks for this month's run from the right start", () => {
    const src = read("supabase/functions/bulk-import-performance/index.ts");
    expect(src).toContain("pacificMonthStart(month)");
    expect(src).not.toContain("-01T00:00:00-08:00");
  });
  it("the daily dump takes its date in B.C. time, not Los Angeles time", () => {
    const src = read("supabase/functions/daily-dump-export/index.ts");
    expect(src).toContain('import "../_shared/bc-time.ts"');
    expect(src).not.toContain("America/Los_Angeles");
  });
});
