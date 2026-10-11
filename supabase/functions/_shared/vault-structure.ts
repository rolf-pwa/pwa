// The shape of a family's Drive folders, and the steps to bring an existing family up to it. Pure (no I/O) so it
// can be unit-tested; vault-service gathers the current state from Drive and applies the steps.
//
//   {Family} Family Vault                  (the Family folder)
//     Family Docs                          (families.vault_root_folder_id; VFO families)
//     {Household} Household Vault          (the Household folder)
//       Household Docs                     (households.vault_root_folder_id; the household's Vault)
//       Personal Docs
//         Personal — {Name}                (contacts.personal_vault_folder_id; private to that adult)
//       Advisor Files                      (staff only; untouched)
//
// Nothing here changes a folder's Drive ID, so every database reference keeps working: folders are renamed,
// one new folder is created per household, and personal drawers move one level down into Personal Docs.

export const FAMILY_DOCS = "Family Docs";
export const HOUSEHOLD_DOCS = "Household Docs";
export const PERSONAL_DOCS = "Personal Docs";

/** "Peters Family" -> "Peters Family Vault"; already-suffixed names are left alone. */
export const withVaultSuffix = (name: string) => (/\bvault$/i.test(name.trim()) ? name.trim() : `${name.trim()} Vault`);

export interface StructureState {
  familyFolder: { id: string; name: string } | null;
  /** Family Docs, when the family has a Family Vault. */
  familyDocs: { id: string; name: string } | null;
  households: Array<{
    householdId: string;
    folder: { id: string; name: string };
    root: { id: string; name: string };
    personalDocs: { id: string; name: string } | null;
    drawers: Array<{ contactId: string; person: string; id: string; name: string; parentId: string | null }>;
  }>;
  /** Only VFO families get a Personal Docs folder and Family Docs. */
  vfo: boolean;
}

export type StructureOp =
  | { op: "rename"; id: string; from: string; to: string; what: string }
  | { op: "create"; key: string; name: string; parent: string; what: string }
  | { op: "move"; id: string; name: string; fromParent: string | null; toParent: string; toParentKey?: string; what: string };

/** Everything needed to reach the structure above; empty when the family is already there. */
export function planRestructure(s: StructureState): StructureOp[] {
  const ops: StructureOp[] = [];
  if (s.familyFolder) {
    const to = withVaultSuffix(s.familyFolder.name);
    if (to !== s.familyFolder.name) ops.push({ op: "rename", id: s.familyFolder.id, from: s.familyFolder.name, to, what: "Family folder" });
  }
  if (s.familyDocs && s.familyDocs.name !== FAMILY_DOCS) ops.push({ op: "rename", id: s.familyDocs.id, from: s.familyDocs.name, to: FAMILY_DOCS, what: "Family Vault root" });
  for (const h of s.households) {
    const to = withVaultSuffix(h.folder.name);
    if (to !== h.folder.name) ops.push({ op: "rename", id: h.folder.id, from: h.folder.name, to, what: "Household folder" });
    if (h.root.name !== HOUSEHOLD_DOCS) ops.push({ op: "rename", id: h.root.id, from: h.root.name, to: HOUSEHOLD_DOCS, what: "Household Vault root" });
    if (s.vfo) {
      let personalParent = h.personalDocs?.id ?? null;
      const key = `personal-docs:${h.householdId}`;
      if (!personalParent) {
        ops.push({ op: "create", key, name: PERSONAL_DOCS, parent: h.folder.id, what: "Personal Docs folder" });
      } else if (h.personalDocs!.name !== PERSONAL_DOCS) {
        ops.push({ op: "rename", id: h.personalDocs!.id, from: h.personalDocs!.name, to: PERSONAL_DOCS, what: "Personal Docs folder" });
      }
      for (const d of h.drawers) {
        if (d.parentId !== personalParent) ops.push({ op: "move", id: d.id, name: d.name, fromParent: d.parentId, toParent: personalParent ?? "", toParentKey: personalParent ? undefined : key, what: `${d.person}'s personal drawer` });
      }
    }
  }
  return ops;
}

export const describeOp = (o: StructureOp): string =>
  o.op === "rename" ? `Rename ${o.what}: “${o.from}” → “${o.to}”`
  : o.op === "create" ? `Create “${o.name}”`
  : `Move ${o.what} into Personal Docs`;
