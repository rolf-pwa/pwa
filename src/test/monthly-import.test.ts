import { describe, it, expect } from "vitest";
import { changePct, classifyChange, resolveBoy, yearToDatePct, normalizeCustodian, monthCheck, missingFromFile, duplicateContracts } from "../../supabase/functions/_shared/monthly-import";

describe("month-over-month changes", () => {
  it("treats normal movement as routine", () => {
    expect(classifyChange(100_000, 104_000)).toEqual({ exception: false, changePct: 4 });
    expect(classifyChange(100_000, 80_000).exception).toBe(false); // -20%
    expect(classifyChange(100_000, 125_000).exception).toBe(false); // exactly +25% is within the threshold
  });
  it("sends a move beyond 25% to a person, with the reason", () => {
    const up = classifyChange(100_000, 126_000);
    expect(up.exception && up.reason).toBe("up 26.0% from last month");
    const down = classifyChange(100_000, 70_000);
    expect(down.exception && down.reason).toBe("down 30.0% from last month");
  });
  it("flags a drop to zero and negative values", () => {
    expect(classifyChange(50_000, 0)).toMatchObject({ exception: true, reason: "dropped to zero" });
    expect(classifyChange(50_000, -5)).toMatchObject({ exception: true, reason: "negative value" });
  });
  it("never flags an account's first value", () => {
    expect(classifyChange(null, 900_000).exception).toBe(false);
    expect(classifyChange(0, 900_000).exception).toBe(false);
    expect(changePct(null, 5)).toBeNull();
  });
  it("honours a different threshold", () => {
    expect(classifyChange(100, 115, 0.1).exception).toBe(true);
  });
});

describe("beginning-of-year value", () => {
  it("uses the row's value, else carries forward what we already had, never 0", () => {
    expect(resolveBoy({ rowBoy: 90, sameYearSnapshotBoy: 80, accountBook: 70, current: 100 })).toBe(90);
    expect(resolveBoy({ rowBoy: null, sameYearSnapshotBoy: 80, accountBook: 70, current: 100 })).toBe(80);
    expect(resolveBoy({ rowBoy: null, sameYearSnapshotBoy: null, accountBook: 70, current: 100 })).toBe(70);
    expect(resolveBoy({ rowBoy: null, sameYearSnapshotBoy: null, accountBook: null, current: 100 })).toBe(100);
  });
  it("computes year-to-date gain from it", () => {
    expect(yearToDatePct(100, 110)).toBe(10);
    expect(yearToDatePct(0, 110)).toBe(0);
  });
});

describe("custodian names", () => {
  it("canonicalises what you type", () => {
    expect(normalizeCustodian("justwealth")).toBe("JustWealth");
    expect(normalizeCustodian("iA")).toBe("iA Financial Group");
    expect(normalizeCustodian("iA Financial Group")).toBe("iA Financial Group");
    expect(normalizeCustodian("  ")).toBeNull();
    expect(normalizeCustodian("Questrade")).toBe("Questrade");
  });
});

describe("the file's date", () => {
  const today = new Date("2026-10-13T12:00:00Z");
  it("accepts a clean month-end after the last import", () => {
    expect(monthCheck("2026-09-30", "2026-08-31", today)).toEqual([]);
    expect(monthCheck("2026-09-30", null, today)).toEqual([]);
  });
  it("warns about a re-import, an older file, a future date and a mid-month date", () => {
    expect(monthCheck("2026-09-30", "2026-09-30", today).join(" ")).toContain("already imported");
    expect(monthCheck("2026-08-31", "2026-09-30", today).join(" ")).toContain("older");
    expect(monthCheck("2026-12-31", null, today).join(" ")).toContain("future");
    expect(monthCheck("2026-09-15", null, today).join(" ")).toContain("last day of a month");
    expect(monthCheck("nope", null, today)).toHaveLength(1);
  });
});

describe("completeness", () => {
  const acc = (n: string, c: string | null) => ({ id: n, table: "vineyard_accounts", accountNumber: n, custodian: c, label: n, owner: "X" });
  it("lists managed accounts the file does not contain, matching contract numbers as text", () => {
    const missing = missingFromFile([acc("111", "iA Financial Group"), acc("222", "JustWealth"), acc("333", null), acc("444", "Pension Co")], ["111 ", "999"]);
    expect(missing.map((m) => m.accountNumber)).toEqual(["222"]);
  });
  it("finds repeated contracts in the file", () => {
    expect([...duplicateContracts(["1", "2", "1", "3", "2"])].sort()).toEqual(["1", "2"]);
  });
});
