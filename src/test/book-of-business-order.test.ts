import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { earliestDue, orderHouseholds, orderOpps } from "../modules/crm/lib/bookOfBusiness";
import { buildMigrationFindings, type MigrationRow } from "../../supabase/functions/_shared/fclass-migration";
import { reconcile } from "../../supabase/functions/_shared/opportunity-reconcile";
import { evaluateHousehold, RULE_VERSION, type HouseholdSnapshot } from "../../supabase/functions/_shared/opportunity-rules";

const o = (due_on: string | null, confidence: "high" | "medium" | "low" = "high") => ({ due_on, confidence });

describe("ordering by date", () => {
  it("finds the soonest date among those that have one", () => {
    expect(earliestDue([o("2027-01-13"), o(null), o("2026-12-24"), o("2027-03-01")])).toBe("2026-12-24");
    expect(earliestDue([o(null)])).toBeNull();
    expect(earliestDue([])).toBeNull();
  });
  it("orders one household's opportunities by date with undated last, and the surest first within a date", () => {
    const list = [o(null, "high"), o("2027-01-13", "low"), o("2026-12-24", "medium"), o("2026-12-24", "high")];
    expect(orderOpps(list, "date").map((x) => `${x.due_on}/${x.confidence}`)).toEqual(["2026-12-24/high", "2026-12-24/medium", "2027-01-13/low", "null/high"]);
  });
  it("orders by confidence alone when asked, ignoring dates", () => {
    expect(orderOpps([o("2026-12-24", "low"), o(null, "high"), o("2027-01-13", "medium")], "confidence").map((x) => x.confidence)).toEqual(["high", "medium", "low"]);
  });
  it("orders households by their soonest date, undated households after, in the usual order", () => {
    const rows = [{ householdId: "a", label: "Abel" }, { householdId: "b", label: "Baird" }, { householdId: "c", label: "Cole" }, { householdId: "d", label: "Dunn" }, { householdId: "e", label: "Eames" }];
    const shown = new Map([
      ["a", [o("2027-01-13"), o("2027-02-01")]], ["b", [o("2026-12-24")]], ["c", []], ["d", [o(null), o(null)]], ["e", [o("2026-12-24"), o(null)]],
    ]);
    // Baird and Eames share the soonest date, so the usual order breaks the tie (Eames has two shown, Baird one); then Abel; then no date: Dunn has two shown, Cole none.
    expect(orderHouseholds(rows, shown, "date").map((r) => r.label)).toEqual(["Eames", "Baird", "Abel", "Dunn", "Cole"]);
  });
  it("keeps the default order (most opportunities, then name) when not sorting by date", () => {
    const rows = [{ householdId: "a", label: "Abel" }, { householdId: "b", label: "Baird" }, { householdId: "c", label: "Cole" }];
    const shown = new Map([["a", [o("2027-01-13")]], ["b", [o("2026-12-24"), o(null)]], ["c", [o("2026-11-01"), o(null)]]]);
    expect(orderHouseholds(rows, shown, "most").map((r) => r.label)).toEqual(["Baird", "Cole", "Abel"]);
  });
});

describe("the date each finding carries", () => {
  const row = (o: Partial<MigrationRow>): MigrationRow => ({ account: "1000000001", accountType: "TFSA", owner: "", investedOn: "2021-12-24", original: 7_000, loadType: "CB5", maturesOn: "2026-12-24", marketValue: 7_698.76, netTransactions: null, ...o });
  it("is the household's earliest chargeback maturity, whatever order the sheet lists them in", () => {
    const rows = [row({ account: "1000000002", maturesOn: "2027-02-10", investedOn: "2022-02-10" }), row({ account: "1000000001", maturesOn: "2026-12-24" })];
    const f = buildMigrationFindings(rows, new Map([["1000000001", "h"], ["1000000002", "h"]]), "2026-10-31").findings[0];
    expect(f.dueOn).toBe("2026-12-24");
  });
  it("is the renewal date for a policy renewing soon", () => {
    const snap = {
      householdId: "h", label: "H", members: [{ id: "a", name: "A", role: "head_of_family", isMinor: false }], familyId: null, familyName: null, pooled: false, familyAum: null, householdAum: 0, isFamilyAnchor: true,
      groupedAum: 0, totalAum: 0, tier: null, tierOnRecord: true, hasRatifiedCharter: false, accounts: [],
      policies: [{ id: "p", type: "term", coverage: 500_000, cashValue: 0, renewalDate: "2026-12-15", insuredContactId: "a", corporate: false }], lifeCoverage: 500_000,
      needs: [{ contactId: "a", need: 1, available: 1, shortfall: 0, createdAt: "2026-06-01T00:00:00Z" }], debts: [], corporations: [], corporatePassiveIncome: null, sbdClawback: null,
      holdingTank: 0, liquidityReserve: 0, liquidityTarget: 0, professionals: { lawyer: true, executor: true, poa: true },
    } as HouseholdSnapshot;
    const f = evaluateHousehold(snap, "2026-10-31").findings.find((x) => x.type === "policy_event");
    expect(f?.dueOn).toBe("2026-12-15");
  });
  it("is stored with a new finding and refreshed on an existing one, and null when a finding has no date", () => {
    const finding = { householdId: "h1", type: "fclass_migration" as const, key: "fclass-migration", title: "t", evidence: [], confidence: "high" as const, nextStep: "n", estValue: null, dueOn: "2026-12-24" };
    const inserted = reconcile([], [finding], new Set(["h1"]), "2026-10-31", RULE_VERSION);
    expect(inserted.inserts[0].due_on).toBe("2026-12-24");
    const updated = reconcile([{ id: "r", household_id: "h1", type: "fclass_migration", key: "fclass-migration", status: "open", snoozed_until: null }], [{ ...finding, dueOn: "2027-01-13" }], new Set(["h1"]), "2026-10-31", RULE_VERSION);
    expect(updated.updates[0].due_on).toBe("2027-01-13");
    expect(reconcile([], [{ ...finding, dueOn: undefined }], new Set(["h1"]), "2026-10-31", RULE_VERSION).inserts[0].due_on).toBeNull();
  });
});

describe("wiring", () => {
  const read = (p: string) => readFileSync(p, "utf8");
  it("the migration adds the date column", () => {
    expect(read("supabase/migrations/20270110120000_opportunity_due_on.sql")).toContain("ADD COLUMN IF NOT EXISTS due_on date");
  });
  it("the page words the sheet's window from the run rather than assuming it, and the run records it", () => {
    expect(read("src/modules/crm/pages/BookOfBusiness.tsx")).toContain("migration.windowMonths ?? 6");
    expect(read("supabase/functions/_shared/opportunity-run.ts")).toContain("windowMonths: DEFAULT_FCLASS.windowMonths");
  });
  it("the page reads the date, offers the sort and the type filter, and orders through the helpers", () => {
    const src = read("src/modules/crm/pages/BookOfBusiness.tsx");
    expect(src).toContain("first_seen, due_on");
    expect(src).toContain("Earliest maturity or renewal first");
    expect(src).toContain("orderHouseholds(");
    expect(src).toContain("orderOpps(");
    expect(src).toContain("All types");
  });
});
