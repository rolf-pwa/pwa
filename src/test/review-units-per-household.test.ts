import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { scopeToUnit, viewerUnit } from "../../supabase/functions/_shared/review-unit-for-contact";

function fakeDb(family: Record<string, unknown> | null, household: Record<string, unknown> | null) {
  return { from: (table: string) => { const q: Record<string, unknown> = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: table === "families" ? family : household }) }; return q; } };
}
const recorder = () => { const calls: [string, unknown][] = []; const q: Record<string, unknown> = { eq: (c: string, v: unknown) => { calls.push(["eq:" + c, v]); return q; }, is: (c: string, v: unknown) => { calls.push(["is:" + c, v]); return q; }, or: (f: string) => { calls.push(["or", f]); return q; } }; return { q, calls }; };

describe("what a client sees of their reviews", () => {
  const vfo = { service_tier: "tier_3", vfo_enabled: true, has_ratified_charter: false, service_tier_source: "computed" };
  it("is the household's own reviews, plus any whole-family one made earlier, for a household of a bound family", async () => {
    const u = await viewerUnit(fakeDb(vfo, { relationship_ended_at: null }), "f1", "h1");
    // householdId stays empty: the household does not "stand alone", so who counts as an adult is unchanged.
    expect(u).toEqual({ householdId: null, tier: "tier_3", reviewHouseholdId: "h1" });
    const { q, calls } = recorder();
    scopeToUnit(q, u);
    expect(calls).toEqual([["or", "household_id.eq.h1,household_id.is.null"]]);
  });
  it("is only the family's for a household whose relationship ended, or a client with no household", async () => {
    expect(await viewerUnit(fakeDb(vfo, { relationship_ended_at: "2026-08-26" }), "f1", "h1")).toMatchObject({ householdId: null, reviewHouseholdId: null });
    expect(await viewerUnit(fakeDb(vfo, null), "f1", null)).toEqual({ householdId: null, tier: "tier_3" });
    const { q, calls } = recorder();
    scopeToUnit(q, { householdId: null, tier: "tier_3", reviewHouseholdId: null });
    expect(calls).toEqual([["is:household_id", null]]);
  });
  it("is unchanged for a household of an unbound family: its own tier and its own reviews only", async () => {
    const plain = { service_tier: "tier_1", vfo_enabled: false, has_ratified_charter: false, service_tier_source: "computed" };
    const u = await viewerUnit(fakeDb(plain, { service_tier: "tier_2a", relationship_ended_at: null }), "f1", "h1");
    expect(u).toEqual({ householdId: "h1", tier: "tier_2a" });
    const { q, calls } = recorder();
    scopeToUnit(q, u);
    expect(calls).toEqual([["eq:household_id", "h1"]]);
  });
});

describe("the weekly tick and the admin page", () => {
  const tick = readFileSync("supabase/functions/review-agent-tick/index.ts", "utf8");
  it("works out which households hold assets, gives bound families a unit per household, and still works a whole-family obligation in flight", () => {
    expect(tick).toContain("householdsHoldingAssets(boundHouseholdIds)");
    expect(tick).toContain("reviewUnits((allFamilies ?? []) as any[], (hhs ?? []) as any[], holdsAssets)");
    expect(tick).toContain("unitByKey.set(unitKey(f.id, null)");
    expect(tick).toContain("familyLevelInFlight(");
    expect(tick).toContain("if (cancellable(o, wanted))");
  });
  it("makes the replacement for an already-open meeting window tracking-only, so no one is invited today", () => {
    expect(tick).toContain('alreadyOpen && m.kind !== "rebalancing"');
    expect(tick).toContain("invite: !(trackingOnly ||");
  });
  it("shows a bound family's household its own reviews and any whole-family one in the workbench", () => {
    expect(readFileSync("supabase/functions/review-agent-admin/index.ts", "utf8")).toContain("q.or(`household_id.eq.${householdId},household_id.is.null`)");
  });
});
