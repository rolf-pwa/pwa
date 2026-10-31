import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { addMonthsYmd, buildMigrationFindings, chargebackPct, dueRows, monthInForce, monthlyFClassFee, parseCsv, parseDate, parseMoney, parseSheet, type MigrationRow } from "../../supabase/functions/_shared/fclass-migration";

const TODAY = "2026-10-31";
const row = (o: Partial<MigrationRow> = {}): MigrationRow => ({
  account: "1000000001", accountType: "TFSA", owner: "Jordan Rivers-Hale", investedOn: "2021-12-24", original: 100_000, loadType: "CB5",
  maturesOn: "2026-12-24", marketValue: 7_698.76, ...o,
});

describe("which month of the deposit's life it is", () => {
  it("is 1 for the first twelve months, then 13 once twelve full months have passed", () => {
    expect(monthInForce("2025-10-31", "2025-10-31")).toBe(1);
    expect(monthInForce("2025-10-31", "2026-10-30")).toBe(12);
    expect(monthInForce("2025-10-31", "2026-10-31")).toBe(13);
    expect(monthInForce("2021-12-24", TODAY)).toBe(59);
  });
  it("copes with short months and a date in the future", () => {
    expect(monthInForce("2024-01-31", "2024-02-29")).toBe(1);
    expect(monthInForce("2027-01-01", TODAY)).toBe(1);
  });
  it("adds months without spilling over the end of a short month", () => {
    expect(addMonthsYmd("2026-10-31", 6)).toBe("2027-04-30");
    expect(addMonthsYmd("2026-08-31", 6)).toBe("2027-02-28");
    expect(addMonthsYmd("2026-10-15", 6)).toBe("2027-04-15");
  });
});

describe("the chargeback percentages in the iA schedule", () => {
  it("CB5 steps down 2 points a month from the 13th to nothing after the 60th", () => {
    for (const [n, pct] of [[1, 100], [12, 100], [13, 98], [24, 76], [36, 52], [59, 6], [60, 4], [61, 0], [90, 0]] as const) expect(chargebackPct("CB5", n), `month ${n}`).toBe(pct);
  });
  it("CB3 steps down 4 points a month to nothing after the 36th", () => {
    for (const [n, pct] of [[12, 100], [13, 96], [24, 52], [32, 20], [36, 4], [37, 0]] as const) expect(chargebackPct("CB3", n), `month ${n}`).toBe(pct);
  });
  it("CB2 uses the published steps and is over after the 24th", () => {
    for (const [n, pct] of [[12, 100], [13, 92.3], [19, 46.1], [22, 23], [24, 7.6], [25, 0]] as const) expect(chargebackPct("CB2", n), `month ${n}`).toBe(pct);
  });
});

describe("the monthly F-class fee", () => {
  it("is the market value times 1%, times the advisor's 80%, over twelve months", () => {
    expect(monthlyFClassFee(7_698.76)).toBe(5.13);
    expect(monthlyFClassFee(120_000)).toBe(80);
    expect(monthlyFClassFee(0)).toBe(0);
  });
  it("follows the configured rate and share", () => {
    expect(monthlyFClassFee(120_000, { windowMonths: 6, feeRate: 0.01, advisorShare: 1 })).toBe(100);
  });
});

describe("reading the sheet", () => {
  it("parses quoted fields with commas, doubled quotes and either line ending", () => {
    expect(parseCsv('a,"b,c","d ""q"""\r\n1,2,3\n')).toEqual([["a", "b,c", 'd "q"'], ["1", "2", "3"]]);
  });
  it("reads money and dates as the sheet shows them", () => {
    expect(parseMoney("$27,791.95")).toBe(27791.95);
    expect(parseMoney("CA$1,200.00")).toBe(1200);
    expect(parseMoney("(50.00)")).toBe(-50);
    expect(parseMoney("")).toBeNull();
    expect(parseMoney("n/a")).toBeNull();
    expect(parseDate("2023-11-30")).toBe("2023-11-30");
    expect(parseDate("11/3/2023")).toBe("2023-11-03");
    expect(parseDate("")).toBeNull();
    expect(parseDate("soon")).toBeNull();
  });
  const csv = [
    "First Name,Last Name,Account Number,Investment Date,Original Investment,Load Type,Contract Status,CB Maturity Date,Account Type,Managed Investments",
    ",,,,,,,,,\"$4,776,920.94\"",
    'JORDAN,RIVERS-HALE,1000000001,2021-12-24,"$100,000.00",cb5,Family,2026-12-24,TFSA,"$7,698.76"',
    "SAM,RIVERS-HALE,1000000002,2025-02-18,,F Class,Sovereign,2025-02-18,RRSP,\"$23,593.70\"",
  ].join("\n");
  it("finds columns by their header names, so the order does not matter, and skips the totals row", () => {
    const { rows, missingColumns } = parseSheet(csv);
    expect(missingColumns).toEqual([]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ account: "1000000001", loadType: "CB5", original: 100000, maturesOn: "2026-12-24", marketValue: 7698.76, owner: "JORDAN RIVERS-HALE" });
    expect(rows[1].original).toBeNull();
  });
  it("names the columns that are missing instead of guessing", () => {
    const r = parseSheet("Account Number,Load Type\n1,CB5");
    expect(r.rows).toEqual([]);
    expect(r.missingColumns).toEqual(expect.arrayContaining(["Original Investment", "CB Maturity Date", "Managed Investments", "Investment Date"]));
  });
});

describe("which accounts are due", () => {
  it("takes chargeback accounts maturing within six months, including ones already matured", () => {
    const rows = [
      row({ account: "1", maturesOn: "2026-12-24" }), row({ account: "2", maturesOn: "2027-04-30" }), row({ account: "3", maturesOn: "2027-05-01" }),
      row({ account: "4", maturesOn: "2026-09-01" }),
    ];
    expect(dueRows(rows, TODAY).due.map((r) => r.account)).toEqual(["1", "2", "4"]);
  });
  it("leaves out F-class, cash and other loads, empty accounts, and counts accounts with no dates", () => {
    const rows = [row({ account: "f", loadType: "FCLASS" }), row({ account: "h", loadType: "HISA" }), row({ account: "z", marketValue: 0 }), row({ account: "n", marketValue: null }), row({ account: "u", maturesOn: null }), row({ account: "ok" })];
    const r = dueRows(rows, TODAY);
    expect(r.due.map((x) => x.account)).toEqual(["ok"]);
    expect(r.undated).toBe(1);
  });
});

describe("the finding for a household", () => {
  const two = [
    row({ account: "1000000001" }),
    row({ account: "1000000002", loadType: "CB3", investedOn: "2024-03-19", maturesOn: "2027-03-19", original: 50_000, marketValue: 135_991, accountType: "RRIF" }),
  ];
  const map = new Map([["1000000001", "h1"], ["1000000002", "h1"]]);

  it("totals the chargeback if moved today and the monthly fee across the household's accounts", () => {
    const r = buildMigrationFindings(two, map, TODAY);
    expect(r.findings).toHaveLength(1);
    const f = r.findings[0];
    // CB5: $100,000 x 4% x 6% (month 59) = $240.  CB3: $50,000 x 2.5% x 20% (month 32) = $250.
    expect(f.evidence[0]).toEqual({ label: "Total chargeback if moved today", value: "$490.00" });
    // $7,698.76 -> $5.13 and $135,991 -> $90.66 a month at 80% of 1%.
    expect(f.evidence[1]).toEqual({ label: "Monthly F-class fee (your 80% of 1%)", value: "$95.79" });
    expect(f.title).toBe("2 accounts near the end of chargeback: chargeback $490.00 if moved today, F-class fee $95.79 a month");
    expect(f.type).toBe("fclass_migration");
    expect(f.confidence).toBe("high");
    expect(r.gaps).toEqual([]);
  });
  it("lists each account with its month in force, the share charged and its own figures, soonest maturity first", () => {
    const lines = buildMigrationFindings(two, map, TODAY).findings[0].evidence.slice(3);
    expect(lines[0].label).toBe("TFSA ...0001 (CB5, matures 2026-12-24, month 59, 6% charged)");
    expect(lines[0].value).toBe("chargeback $240.00; fee $5.13/month");
    expect(lines[1].label).toContain("RRIF ...0002 (CB3, matures 2027-03-19, month 32, 20% charged)");
  });
  it("says 'at least' and drops to medium confidence when an original investment is missing, and reports the gap", () => {
    const r = buildMigrationFindings([two[0], { ...two[1], original: null }], map, TODAY);
    expect(r.findings[0].title).toContain("chargeback at least $240.00 if moved today");
    expect(r.findings[0].confidence).toBe("medium");
    expect(r.gaps).toHaveLength(1);
    expect(r.gaps[0]).toMatchObject({ householdId: "h1", field: "Original investment (migration sheet)", blocks: ["fclass_migration"] });
  });
  it("does not show a zero chargeback when every original investment is missing", () => {
    const r = buildMigrationFindings(two.map((x) => ({ ...x, original: null })), map, TODAY);
    expect(r.findings[0].title).toContain("chargeback not yet known");
    expect(r.findings[0].evidence[0].value).toBe("Not known: original investment missing");
    expect(r.findings[0].title).not.toContain("$0");
  });
  it("makes one finding per household and lists accounts that match no household by their last digits only", () => {
    const rows = [...two, row({ account: "1000000003" }), row({ account: "9999 8888 7777" })];
    const r = buildMigrationFindings(rows, new Map([["1000000001", "h1"], ["1000000002", "h1"], ["1000000003", "h2"]]), TODAY);
    expect(r.findings.map((f) => f.householdId).sort()).toEqual(["h1", "h2"]);
    expect(r.unmatched).toEqual(["7777"]);
    expect(r.dueCount).toBe(4);
  });
  it("matches account numbers however they are punctuated", () => {
    const r = buildMigrationFindings([row({ account: "1000-000-001" })], new Map([["1000000001", "h1"]]), TODAY);
    expect(r.findings).toHaveLength(1);
  });
  it("tells you when nothing is left to charge back", () => {
    const r = buildMigrationFindings([row({ maturesOn: "2026-09-01", investedOn: "2021-08-01" })], new Map([["1000000001", "h1"]]), TODAY);
    expect(r.findings[0].nextStep).toContain("costs nothing in chargeback");
    expect(r.findings[0].evidence[0].value).toBe("$0.00");
  });
  it("never writes an estimated value, so no figure is presented as revenue", () => {
    expect(buildMigrationFindings(two, map, TODAY).findings[0].estValue).toBeNull();
  });
});

describe("wiring", () => {
  const read = (p: string) => readFileSync(p, "utf8");
  it("the sheet is only read: one export request, no writes", () => {
    const src = read("supabase/functions/_shared/fclass-migration-service.ts");
    expect(src).toContain("/export?");
    expect(src).not.toMatch(/method:\s*["'](POST|PUT|PATCH|DELETE)/);
    expect(src).not.toMatch(/\.(insert|update|upsert|delete)\(/);
  });
  it("the pure rule module has no imports besides types, and no network or database access", () => {
    const src = read("supabase/functions/_shared/fclass-migration.ts");
    expect(src.match(/^import .*$/gm)).toEqual(['import type { DataGap, Finding } from "./opportunity-rules.ts";']);
    expect(src).not.toMatch(/fetch\(|\.from\(/);
  });
  it("the weekly run reads the sheet, and leaves these findings alone when it cannot", () => {
    const src = read("supabase/functions/_shared/opportunity-run.ts");
    expect(src).toContain("loadMigrationCsv(db)");
    expect(src).toContain('"fclass_migration"');
    expect(src).toContain("migration,");
  });
  it("the migration allows the new type and the page labels it", () => {
    expect(read("supabase/migrations/20270109120000_opportunity_fclass_type.sql")).toContain("'fclass_migration'");
    expect(read("src/modules/crm/pages/BookOfBusiness.tsx")).toContain('fclass_migration: "F-class migration"');
  });
});
