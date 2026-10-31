import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { reconcile, type StoredOpportunity } from "../../supabase/functions/_shared/opportunity-reconcile";
import { RULE_VERSION, type Finding } from "../../supabase/functions/_shared/opportunity-rules";
import { JOBS } from "../../supabase/functions/_shared/job-health";

const TODAY = "2026-11-02";
const finding = (o: Partial<Finding> = {}): Finding => ({
  householdId: "h1", type: "idle_cash", key: "holding-tank", title: "$60,000 waiting in the holding tank",
  evidence: [{ label: "Holding tank balance", value: "$60,000" }], confidence: "high", nextStep: "Place it.", estValue: null, ...o,
});
const stored = (o: Partial<StoredOpportunity> = {}): StoredOpportunity => ({ id: "r1", household_id: "h1", type: "idle_cash", key: "holding-tank", status: "open", snoozed_until: null, ...o });
const plan = (existing: StoredOpportunity[], findings: Finding[], evaluated = ["h1"]) => reconcile(existing, findings, new Set(evaluated), TODAY, RULE_VERSION);

describe("reconciling a run with what is stored", () => {
  it("inserts a new finding with first and last seen set to today and the rule version", () => {
    const p = plan([], [finding()]);
    expect(p.inserts).toHaveLength(1);
    expect(p.inserts[0]).toMatchObject({ household_id: "h1", type: "idle_cash", key: "holding-tank", first_seen: TODAY, last_seen: TODAY, rule_version: RULE_VERSION, est_value: null });
    expect(p.updates).toEqual([]);
    expect(p.resolves).toEqual([]);
  });

  it("refreshes an existing finding instead of adding a second row", () => {
    const p = plan([stored()], [finding({ title: "$80,000 waiting in the holding tank" })]);
    expect(p.inserts).toEqual([]);
    expect(p.updates).toHaveLength(1);
    expect(p.updates[0]).toMatchObject({ id: "r1", title: "$80,000 waiting in the holding tank", last_seen: TODAY, reopen: false });
  });

  it("treats the same type with a different key as a separate opportunity", () => {
    const p = plan([stored()], [finding(), finding({ key: "liquidity-surplus" })]);
    expect(p.inserts.map((i) => i.key)).toEqual(["liquidity-surplus"]);
  });

  it("does not reopen a dismissed or converted opportunity that still fires", () => {
    for (const status of ["dismissed", "converted"] as const) {
      const p = plan([stored({ status })], [finding()]);
      expect(p.updates[0].reopen).toBe(false);
      expect(p.resolves).toEqual([]);
    }
  });

  it("keeps a snooze until its date, then reopens it", () => {
    expect(plan([stored({ status: "snoozed", snoozed_until: "2026-12-01" })], [finding()]).updates[0].reopen).toBe(false);
    expect(plan([stored({ status: "snoozed", snoozed_until: TODAY })], [finding()]).updates[0].reopen).toBe(true);
    expect(plan([stored({ status: "snoozed", snoozed_until: null })], [finding()]).updates[0].reopen).toBe(true);
  });

  it("reopens a resolved opportunity that fires again", () => {
    expect(plan([stored({ status: "resolved" })], [finding()]).updates[0].reopen).toBe(true);
  });

  it("resolves an open or snoozed opportunity that stops firing, and leaves decided ones alone", () => {
    expect(plan([stored()], []).resolves).toEqual(["r1"]);
    expect(plan([stored({ status: "snoozed", snoozed_until: "2027-01-01" })], []).resolves).toEqual(["r1"]);
    expect(plan([stored({ status: "dismissed" })], []).resolves).toEqual([]);
    expect(plan([stored({ status: "converted" })], []).resolves).toEqual([]);
    expect(plan([stored({ status: "resolved" })], []).resolves).toEqual([]);
  });

  it("never resolves the opportunities of a household that could not be read", () => {
    const p = plan([stored({ household_id: "h2", id: "r2" })], [], ["h1"]);
    expect(p.resolves).toEqual([]);
  });

  it("resolves what is still live for a household whose relationship has ended, but not a decided opportunity", () => {
    const existing = [stored({ id: "a", household_id: "gone" }), stored({ id: "b", household_id: "gone", key: "x", status: "dismissed" }), stored({ id: "c", household_id: "unread" })];
    const p = reconcile(existing, [], new Set(["h1"]), TODAY, RULE_VERSION, new Set(["gone"]));
    expect(p.resolves).toEqual(["a"]);
  });
  it("leaves a kind of finding alone when its source could not be read this run", () => {
    const existing = [stored({ id: "m", type: "fclass_migration", key: "fclass-migration" }), stored({ id: "i", type: "idle_cash" })];
    const p = reconcile(existing, [], new Set(["h1"]), TODAY, RULE_VERSION, new Set(), new Set(["fclass_migration"]));
    expect(p.resolves).toEqual(["i"]);
  });
  it("handles several households and keys in one run", () => {
    const existing = [stored({ id: "a" }), stored({ id: "b", household_id: "h2" }), stored({ id: "c", household_id: "h2", key: "liquidity-surplus" })];
    const p = plan(existing, [finding(), finding({ householdId: "h2" })], ["h1", "h2"]);
    expect(p.updates.map((u) => u.id).sort()).toEqual(["a", "b"]);
    expect(p.resolves).toEqual(["c"]);
  });
});

describe("wiring", () => {
  const read = (p: string) => readFileSync(p, "utf8");
  it("the reconcile module has no imports besides a type, and no database access", () => {
    const src = read("supabase/functions/_shared/opportunity-reconcile.ts");
    expect(src.match(/^import .*$/gm)).toEqual(['import type { Finding } from "./opportunity-rules.ts";']);
    expect(src).not.toMatch(/fetch\(|\.from\(/);
  });
  it("the run function is staff only and starts the tracked weekly job", () => {
    const src = read("supabase/functions/book-of-business-run/index.ts");
    expect(src).toContain("requireStaff");
    expect(src).toContain("@prosperwise.ca");
    expect(src).toContain('trackJob(db, "book_of_business"');
  });
  it("the Monday cron reaches the same job through the briefing dispatcher, and the watchdog knows it", () => {
    expect(read("supabase/functions/daily-briefing-generate/index.ts")).toContain('trackJob(db, "book_of_business"');
    const sql = read("supabase/migrations/20270107130000_opportunities.sql");
    expect(sql).toContain('"job":"book_of_business"');
    expect(sql).toContain("cron.schedule");
    expect(JOBS.map((j) => j.key)).toContain("book_of_business");
  });
  it("the migration limits access to staff, grants explicitly, and lets staff update but not add or delete", () => {
    const sql = read("supabase/migrations/20270107130000_opportunities.sql");
    expect(sql).toContain("GRANT SELECT, UPDATE ON public.opportunities TO authenticated");
    expect(sql).toContain("GRANT ALL ON public.opportunities, public.opportunity_runs TO service_role");
    expect(sql).not.toMatch(/GRANT[^;]*(INSERT|DELETE)[^;]*TO authenticated/);
    expect((sql.match(/LIKE '%@prosperwise\.ca'/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });
  it("the migration's types match the rulebook's", () => {
    // The latest constraint wins: the original migration plus the one that added a type.
    const sql = read("supabase/migrations/20270107130000_opportunities.sql") + read("supabase/migrations/20270109120000_opportunity_fclass_type.sql");
    const rules = read("supabase/functions/_shared/opportunity-rules.ts");
    const typeUnion = rules.slice(rules.indexOf("export type OpportunityType"), rules.indexOf("export type Confidence"));
    for (const t of [...typeUnion.matchAll(/"([a-z_]+)"/g)].map((m) => m[1])) expect(sql).toContain(`'${t}'`);
  });
  it("the runner writes only through the reconciled plan and never deletes", () => {
    const src = read("supabase/functions/_shared/opportunity-run.ts");
    expect(src).not.toMatch(/\.delete\(/);
    expect(src).toContain("reconcile(");
  });
  it("the page reads stored opportunities and the run, and starts runs through the function", () => {
    const src = read("src/modules/crm/pages/BookOfBusiness.tsx");
    expect(src).toContain('from("opportunities"');
    expect(src).toContain('from("opportunity_runs"');
    expect(src).toContain('"book-of-business-run"');
  });
});
