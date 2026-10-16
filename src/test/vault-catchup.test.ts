import { describe, it, expect } from "vitest";
import { planVaultCatchUp } from "../../supabase/functions/_shared/vault-catchup";

const hh = (over: object) => ({ id: "h", label: "Primary", familyName: "Glanz", serviceTier: "tier_1", relationshipEnded: false, vaultRoot: null, vaultFolder: null, ...over });
const person = (over: object) => ({ householdId: "h", role: "head_of_family", isMinor: false, personalDrawer: null, ...over });

describe("vault catch-up plan", () => {
  it("builds a Vault for a tiered household with none", () => {
    const p = planVaultCatchUp([hh({ id: "a" })], []);
    expect(p.provision).toEqual([{ id: "a", name: "Glanz: Primary", tier: "tier_1" }]);
    expect(p.drawers).toEqual([]);
  });
  it("leaves untiered and ended households alone", () => {
    const p = planVaultCatchUp([hh({ id: "a", serviceTier: null }), hh({ id: "b", relationshipEnded: true })], []);
    expect(p).toEqual({ provision: [], legacy: [], drawers: [] });
  });
  it("adds personal drawers where a household with a Vault has adults without one", () => {
    const p = planVaultCatchUp([hh({ id: "a", vaultRoot: "root", vaultFolder: "f" }), hh({ id: "b", vaultRoot: "root", vaultFolder: "f", familyName: "Reid" })], [
      person({ householdId: "a" }), person({ householdId: "a", role: "spouse", personalDrawer: "d" }), person({ householdId: "b", personalDrawer: "d" }), person({ householdId: "a", role: "child", isMinor: true }),
    ]);
    expect(p.drawers).toEqual([{ id: "a", name: "Glanz: Primary", missing: 1 }]);
  });
  it("includes an untiered household's drawers once it has a Vault", () => {
    expect(planVaultCatchUp([hh({ id: "a", serviceTier: null, vaultRoot: "root", vaultFolder: "f" })], [person({ householdId: "a" })]).drawers).toHaveLength(1);
  });
  it("brings a household on the older layout (a root, no Household Vault folder) to the current one, tiered or not", () => {
    const p = planVaultCatchUp([hh({ id: "a", vaultRoot: "old" }), hh({ id: "b", serviceTier: null, vaultRoot: "old", familyName: "Reid" }), hh({ id: "c", vaultRoot: "old", relationshipEnded: true })], [person({ householdId: "a" })]);
    expect(p.legacy).toEqual([{ id: "a", name: "Glanz: Primary" }, { id: "b", name: "Reid: Primary" }]);
    expect(p.drawers).toEqual([]);
  });
});
