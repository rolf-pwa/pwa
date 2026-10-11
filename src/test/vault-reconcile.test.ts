import { describe, it, expect } from "vitest";
import { planReconcile } from "../../supabase/functions/_shared/vault-reconcile";

const hh = (id: string, o: any = {}) => ({ id, family_id: "f1", governance_status: "core", vault_root_folder_id: "root-" + id, members: 2, ...o });

describe("planReconcile", () => {
  it("gives a new adult in a household with a Vault a personal drawer, and nobody who has one", () => {
    const plan = planReconcile({
      households: [hh("h1")], families: [{ id: "f1", vault_folder_id: "top" }],
      adults: [
        { contact_id: "a", household_id: "h1", personal_vault_folder_id: "p1" },
        { contact_id: "b", household_id: "h1", personal_vault_folder_id: null },
      ],
    });
    expect(plan.drawers).toEqual([{ householdId: "h1", contactIds: ["b"] }]);
  });
  it("does not create drawers in a household that has no Vault yet", () => {
    const plan = planReconcile({ households: [hh("h1", { vault_root_folder_id: null })], families: [], adults: [{ contact_id: "a", household_id: "h1", personal_vault_folder_id: null }] });
    expect(plan.drawers).toEqual([]);
  });
  it("provisions a new household in a family that already has a Family Vault", () => {
    const plan = planReconcile({ households: [hh("h1"), hh("h2", { vault_root_folder_id: null })], families: [{ id: "f1", vault_folder_id: "top" }], adults: [] });
    expect(plan.newHouseholds).toEqual(["h2"]);
  });
  it("leaves prospects, empty households and families without a Family Vault alone", () => {
    const plan = planReconcile({
      households: [
        hh("p", { vault_root_folder_id: null, governance_status: "none" }),
        hh("e", { vault_root_folder_id: null, members: 0 }),
        hh("o", { vault_root_folder_id: null, family_id: "f2" }),
        hh("n", { vault_root_folder_id: null, family_id: null }),
      ],
      families: [{ id: "f1", vault_folder_id: "top" }, { id: "f2", vault_folder_id: null }], adults: [],
    });
    expect(plan.newHouseholds).toEqual([]);
  });
});
