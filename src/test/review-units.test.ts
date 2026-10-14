import { describe, it, expect } from "vitest";
import { reviewUnits, isPooledFamily, familyDisplayTier } from "../../supabase/functions/_shared/review-units";

const fam = (over: Record<string, unknown> = {}) => ({ id: "f1", name: "Glanz", service_tier: "tier_1", vfo_enabled: false, has_ratified_charter: false, service_tier_source: "computed", ...over });
const hh = (id: string, tier: string | null, over: Record<string, unknown> = {}) => ({ id, family_id: "f1", label: id, service_tier: tier, relationship_ended_at: null, ...over });

describe("who owes a meeting", () => {
  it("treats each household of an unchartered family as its own unit, each on its own tier", () => {
    const u = reviewUnits([fam()], [hh("Lydia", "tier_1"), hh("Andrew", "tier_1")]);
    expect(u.map((x) => [x.key, x.tier, x.name])).toEqual([["f1|Lydia", "tier_1", "Glanz: Lydia"], ["f1|Andrew", "tier_1", "Glanz: Andrew"]]);
  });
  it("keeps a chartered family, a VFO and a hand-set tier pooled as one unit", () => {
    for (const over of [{ has_ratified_charter: true }, { vfo_enabled: true }, { service_tier_source: "manual_override" }]) {
      const u = reviewUnits([fam({ service_tier: "tier_3", ...over })], [hh("a", "tier_1"), hh("b", "tier_1")]);
      expect(u).toEqual([{ key: "f1", familyId: "f1", householdId: null, name: "Glanz", tier: "tier_3" }]);
      expect(isPooledFamily(fam(over))).toBe(true);
    }
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
