import { describe, it, expect } from "vitest";
import { reviewUnits, isPooledFamily, familyDisplayTier, familyLevelInFlight, cancellable, mainHouseholdIds } from "../../supabase/functions/_shared/review-units";

const fam = (over: Record<string, unknown> = {}) => ({ id: "f1", name: "Glanz", service_tier: "tier_1", vfo_enabled: false, has_ratified_charter: false, service_tier_source: "computed", ...over });
const hh = (id: string, tier: string | null, over: Record<string, unknown> = {}) => ({ id, family_id: "f1", label: id, service_tier: tier, relationship_ended_at: null, ...over });

describe("who owes a meeting", () => {
  it("treats each household of an unchartered family as its own unit, each on its own tier", () => {
    const u = reviewUnits([fam()], [hh("Lydia", "tier_1"), hh("Andrew", "tier_1")]);
    expect(u.map((x) => [x.key, x.tier, x.name])).toEqual([["f1|Lydia", "tier_1", "Glanz: Lydia"], ["f1|Andrew", "tier_1", "Glanz: Andrew"]]);
  });
  it("gives the main household of a chartered family, a VFO and a hand-set tier the family's tier, and each other household its own", () => {
    for (const over of [{ has_ratified_charter: true }, { vfo_enabled: true }, { service_tier_source: "manual_override" }]) {
      const u = reviewUnits([fam({ service_tier: "tier_3", ...over })], [hh("main", null), hh("z", "tier_1")], new Set(["main", "z"]), new Set(["main"]));
      expect(u).toEqual([
        { key: "f1|main", familyId: "f1", householdId: "main", name: "Glanz: main", tier: "tier_3", main: true },
        { key: "f1|z", familyId: "f1", householdId: "z", name: "Glanz: z", tier: "tier_1", main: false },
      ]);
      expect(isPooledFamily(fam(over))).toBe(true);
    }
  });
  it("owes nothing for another household that has no tier of its own yet, and takes the main household even when nothing is recorded under it", () => {
    const f = fam({ vfo_enabled: true, service_tier: "tier_3" });
    const rows = [hh("main", null), hh("a", null), hh("b", "tier_2a"), hh("c", "tier_1")];
    expect(reviewUnits([f], rows, new Set(["a", "b"]), new Set(["main"])).map((x) => [x.key, x.tier])).toEqual([["f1|main", "tier_3"], ["f1|b", "tier_2a"]]);
    expect(reviewUnits([f], rows, new Set(["b", "c"]), new Set(["main"])).map((x) => x.key)).toEqual(["f1|main", "f1|b", "f1|c"]);
  });
  it("gives every household the family's tier when no household holds a head of the family, so nobody is left without a schedule", () => {
    const f = fam({ vfo_enabled: true, service_tier: "tier_3" });
    expect(reviewUnits([f], [hh("a", null), hh("b", "tier_1")], new Set(["a", "b"]), new Set()).map((x) => [x.key, x.tier])).toEqual([["f1|a", "tier_3"], ["f1|b", "tier_3"]]);
    expect(reviewUnits([f], [hh("a", null)], undefined, undefined).map((x) => [x.key, x.tier])).toEqual([["f1|a", "tier_3"]]);
  });
  it("keeps the family whole when it has no households at all, and finds the main household by the head of the family", () => {
    const f = fam({ vfo_enabled: true, service_tier: "tier_1" });
    expect(reviewUnits([f], [], new Set())).toEqual([{ key: "f1", familyId: "f1", householdId: null, name: "Glanz", tier: "tier_1" }]);
    expect([...mainHouseholdIds([{ household_id: "h1", family_role: "head_of_family" }, { household_id: "h2", family_role: "head_of_household" }, { household_id: null, family_role: "head_of_family" }])]).toEqual(["h1"]);
  });
  it("names the household by the family alone when it is the family's only active household, and skips one whose relationship ended", () => {
    const f = fam({ vfo_enabled: true });
    expect(reviewUnits([f], [hh("a", null), hh("b", null, { relationship_ended_at: "2026-08-26" })], new Set(["a", "b"]), new Set(["a"])).map((x) => [x.key, x.name])).toEqual([["f1|a", "Glanz"]]);
  });
  it("does not give a bound family a unit when it has no tier", () => {
    expect(reviewUnits([fam({ vfo_enabled: true, service_tier: null })], [hh("a", null)], new Set(["a"]), new Set(["a"]))).toEqual([]);
  });
  it("skips a household whose advisory relationship ended, and a family where all have ended", () => {
    expect(reviewUnits([fam()], [hh("a", "tier_2a"), hh("b", "tier_1", { relationship_ended_at: "2026-08-26" })]).map((x) => x.key)).toEqual(["f1|a"]);
    expect(reviewUnits([fam({ vfo_enabled: true, service_tier: "tier_3" })], [hh("a", "tier_1", { relationship_ended_at: "2026-08-26" })])).toEqual([]);
  });
  it("names a single-household family by the family alone", () => {
    expect(reviewUnits([fam()], [hh("only", "tier_2a")])[0].name).toBe("Glanz");
  });
  it("shows the highest household tier for the family", () => {
    expect(familyDisplayTier(["tier_1", "tier_2a", "tier_1"])).toBe("tier_2a");
    expect(familyDisplayTier([])).toBeNull();
  });
});

describe("households with nothing to review", () => {
  it("owe no meetings when they have no tier, and Tier 0 (insurance only) owes none by cadence", async () => {
    const { requiredObligations } = await import("../../supabase/functions/_shared/review-windows");
    const u = reviewUnits([fam()], [hh("empty", null), hh("insured", "tier_0"), hh("real", "tier_1")]);
    expect(u.map((x) => x.key)).toEqual(["f1|insured", "f1|real"]);
    expect(requiredObligations("tier_0", 2027)).toEqual([]);
  });
});

describe("converting the whole-family obligations to per-household ones", () => {
  const ob = (over: Record<string, unknown> = {}) => ({ family_id: "f1", household_id: null as string | null, window_key: "2026-Q4-rebalancing", status: "open", published_at: null as string | null, ...over });
  it("does not make a household's obligation for a window where a whole-family one is already in flight", () => {
    const inFlight = familyLevelInFlight([ob({ status: "booked" }), ob({ window_key: "w2", published_at: "2026-11-02" }), ob({ window_key: "w3", status: "escalated" }), ob({ window_key: "w4", status: "held" }), ob({ window_key: "w5", status: "paused" })]);
    expect([...inFlight].sort()).toEqual(["f1|2026-Q4-rebalancing", "f1|w2", "f1|w3", "f1|w4", "f1|w5"]);
  });
  it("lets an open, unpublished, cancelled or household-level obligation be replaced", () => {
    expect(familyLevelInFlight([ob(), ob({ status: "cancelled" }), ob({ household_id: "h1", status: "booked" })]).size).toBe(0);
  });
  it("cancels an open obligation nobody owes any more, but never one already published to the client", () => {
    const wanted = new Set(["f1|h1|2026-Q4-rebalancing"]);
    expect(cancellable(ob(), wanted)).toBe(true);
    expect(cancellable(ob({ published_at: "2026-11-02" }), wanted)).toBe(false);
    expect(cancellable(ob({ status: "booked" }), wanted)).toBe(false);
    expect(cancellable(ob({ household_id: "h1" }), wanted)).toBe(false);
  });
});
