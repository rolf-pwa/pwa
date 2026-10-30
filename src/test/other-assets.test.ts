import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { allocateCapital, staleOtherAssets, type AllocInput } from "../../supabase/functions/_shared/quarterly-review-allocation";
import { evenSplit, ownerSplitError, shareOfValue, valueIsStale } from "../modules/crm/lib/otherAssets";

const base = (o: Partial<AllocInput> = {}): AllocInput => ({
  aum: 100_000, netWorth: 100_000, holdingTank: 0, vineyard: 100_000,
  reserves: { liquidity: 0, strategic: 0, philanthropic: 0, legacy: 0 },
  liquidityStorehouse: { exists: true, target: 1 }, accounts: [], policies: [], today: "2026-10-30", ...o,
});

describe("owner splits", () => {
  it("accepts individual and joint splits that total 100", () => {
    expect(ownerSplitError([{ contact_id: "a", ownership_pct: 100 }])).toBeNull();
    expect(ownerSplitError([{ contact_id: "a", ownership_pct: 50 }, { contact_id: "b", ownership_pct: 50 }])).toBeNull();
  });
  it("rejects no owner, repeats and totals other than 100", () => {
    expect(ownerSplitError([])).toMatch(/at least one/);
    expect(ownerSplitError([{ contact_id: "a", ownership_pct: 50 }, { contact_id: "a", ownership_pct: 50 }])).toMatch(/once/);
    expect(ownerSplitError([{ contact_id: "a", ownership_pct: 60 }, { contact_id: "b", ownership_pct: 30 }])).toMatch(/90%/);
  });
  it("splits evenly to exactly 100, even for thirds", () => {
    const t = evenSplit(["a", "b", "c"]);
    expect(Math.round(t.reduce((s, o) => s + o.ownership_pct, 0) * 100) / 100).toBe(100);
    expect(ownerSplitError(t)).toBeNull();
    expect(shareOfValue(800_000, 50)).toBe(400_000);
  });
});

describe("stale values", () => {
  it("flags a missing date or one over 12 months old", () => {
    expect(valueIsStale(null, "2026-10-30")).toBe(true);
    expect(valueIsStale("2025-10-29", "2026-10-30")).toBe(true);
    expect(valueIsStale("2025-11-15", "2026-10-30")).toBe(false);
  });
  it("lists only valued assets that are stale", () => {
    const r = staleOtherAssets([{ name: "Home", value: 900_000, as_of: "2024-01-01" }, { name: "Truck", value: 40_000, as_of: "2026-09-01" }, { name: "Empty", value: null, as_of: null }], "2026-10-30");
    expect(r.map((a) => a.name)).toEqual(["Home"]);
  });
});

describe("other assets in the allocation", () => {
  it("adds them once, at full value, to the Legacy Trust, assets and net worth", () => {
    const r = allocateCapital(base({ otherAssets: [{ name: "Home", value: 900_000, as_of: "2026-09-01" }, { name: "Truck", value: 40_000, as_of: "2026-09-01" }] }));
    expect(r.otherAssetsAdded).toBe(940_000);
    expect(r.realEstateAdded).toBe(940_000);
    expect(r.reserves.legacy).toBe(940_000);
    expect(r.aum).toBe(1_040_000);
    expect(r.netWorth).toBe(1_040_000);
    expect(r.notes.join(" ")).toContain("other assets (Home, Truck)");
  });
  it("keeps real-estate Storehouse rows and other assets in one total without double counting", () => {
    const r = allocateCapital(base({ realEstate: { legacy: 500_000 }, otherAssets: [{ name: "Truck", value: 40_000, as_of: "2026-09-01" }] }));
    expect(r.reserves.legacy).toBe(540_000);
    expect(r.realEstateAdded).toBe(540_000);
  });
  it("notes assets whose value is out of date and ignores empty ones", () => {
    const r = allocateCapital(base({ otherAssets: [{ name: "Home", value: 900_000, as_of: "2024-01-01" }, { name: "Boat", value: null }] }));
    expect(r.otherAssetsAdded).toBe(900_000);
    expect(r.notes.join(" ")).toContain("Update the value of Home");
  });
  it("changes nothing when there are none", () => {
    const r = allocateCapital(base());
    expect(r.otherAssetsAdded).toBe(0);
    expect(r.aum).toBe(100_000);
  });
});

describe("wiring", () => {
  const alloc = readFileSync("supabase/functions/_shared/review-allocation.ts", "utf8");
  it("skips a real-estate Storehouse row once an Other Asset replaces it", () => {
    expect(alloc).toContain('.from("other_assets")');
    expect(alloc).toContain("!replaced.has(s.id)");
  });
  it("is on the household page and the migration grants the app roles", () => {
    expect(readFileSync("src/modules/crm/pages/HouseholdDetail.tsx", "utf8")).toContain("<OtherAssetsCard");
    const m = readFileSync("supabase/migrations/20270106120000_other_assets.sql", "utf8");
    expect(m).toContain("TO authenticated");
    expect(m).toContain("TO service_role");
  });
});
