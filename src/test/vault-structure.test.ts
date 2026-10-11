import { describe, it, expect } from "vitest";
import { planRestructure, withVaultSuffix, describeOp, type StructureState } from "../../supabase/functions/_shared/vault-structure";

const base = (o: Partial<StructureState> = {}): StructureState => ({
  vfo: true,
  familyFolder: { id: "ff", name: "Demo Family" },
  familyDocs: { id: "fd", name: "Family Vault — Demo" },
  households: [{
    householdId: "h1", folder: { id: "hf", name: "Demo Household" }, root: { id: "hr", name: "1. ProsperWise Vault — Demo Family (Demo Household)" },
    personalDocs: null, drawers: [{ contactId: "c1", person: "Demo Contact", id: "d1", name: "Personal — Demo Contact", parentId: "hf" }],
  }],
  ...o,
});

describe("vault structure", () => {
  it("adds ' Vault' once", () => {
    expect(withVaultSuffix("Demo Family")).toBe("Demo Family Vault");
    expect(withVaultSuffix("Demo Family Vault")).toBe("Demo Family Vault");
    expect(withVaultSuffix("  Kirk Household ")).toBe("Kirk Household Vault");
  });
  it("brings the current Demo layout to the new one without changing any folder's ID", () => {
    const ops = planRestructure(base());
    expect(ops.map((o) => describeOp(o))).toEqual([
      "Rename Family folder: “Demo Family” → “Demo Family Vault”",
      "Rename Family Vault root: “Family Vault — Demo” → “Family Docs”",
      "Rename Household folder: “Demo Household” → “Demo Household Vault”",
      "Rename Household Vault root: “1. ProsperWise Vault — Demo Family (Demo Household)” → “Household Docs”",
      "Create “Personal Docs”",
      "Move Demo Contact's personal drawer into Personal Docs",
    ]);
    const move = ops.at(-1) as any;
    expect(move).toMatchObject({ op: "move", id: "d1", fromParent: "hf", toParent: "", toParentKey: "personal-docs:h1" });
    expect(ops.some((o: any) => o.op === "rename" && o.id === "hr")).toBe(true);
  });
  it("does nothing for a family that is already in shape", () => {
    const done = base({
      familyFolder: { id: "ff", name: "Demo Family Vault" }, familyDocs: { id: "fd", name: "Family Docs" },
      households: [{ householdId: "h1", folder: { id: "hf", name: "Demo Household Vault" }, root: { id: "hr", name: "Household Docs" }, personalDocs: { id: "pd", name: "Personal Docs" }, drawers: [{ contactId: "c1", person: "Demo Contact", id: "d1", name: "Personal — Demo Contact", parentId: "pd" }] }],
    });
    expect(planRestructure(done)).toEqual([]);
  });
  it("moves drawers into an existing Personal Docs folder", () => {
    const s = base();
    s.households[0].personalDocs = { id: "pd", name: "Personal Docs" };
    const ops = planRestructure(s);
    expect(ops.find((o) => o.op === "create")).toBeUndefined();
    expect(ops.find((o) => o.op === "move")).toMatchObject({ toParent: "pd" });
  });
  it("leaves personal folders alone for a family that is not on the VFO", () => {
    const ops = planRestructure(base({ vfo: false, familyDocs: null }));
    expect(ops.some((o) => o.op === "create" || o.op === "move")).toBe(false);
    expect(ops.map((o) => o.op)).toEqual(["rename", "rename", "rename"]);
  });
});
