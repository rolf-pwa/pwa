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
const RESERVED = new Set([FAMILY_DOCS, HOUSEHOLD_DOCS, PERSONAL_DOCS].map((n) => n.toLowerCase()));
/** A household folder that was renamed to one of the three inner names by mistake gets a proper name again. */
export const isReservedName = (name: string) => RESERVED.has(name.trim().toLowerCase());

export const withVaultSuffix = (name: string) => (/\bvault$/i.test(name.trim()) ? name.trim() : `${name.trim()} Vault`);

export interface StructureState {
  familyName?: string;
  familyFolder: { id: string; name: string } | null;
  /** When the Family Vault root was set to the Family folder itself (so it also contains the household Vaults): the
   * child folder that holds the family's shared documents, if there is exactly one. */
  familyDocsCandidate?: { id: string; name: string } | null;
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
  /** Point the family's Vault root (families.vault_root_folder_id) at a different folder. */
  | { op: "repoint"; from: string; to: string; toKey?: string; what: string }
  | { op: "move"; id: string; name: string; fromParent: string | null; toParent: string; toParentKey?: string; what: string };

/** Everything needed to reach the structure above; empty when the family is already there. */
export function planRestructure(s: StructureState): StructureOp[] {
  const ops: StructureOp[] = [];
  // The Family Vault root must be Family Docs, never the Family folder that also holds the household Vaults:
  // access to the family's shared documents must not reach into any household. Fix that first.
  const misrooted = !!(s.familyDocs && s.familyFolder && s.familyDocs.id === s.familyFolder.id);
  if (misrooted) {
    const top = s.familyFolder!;
    const topTarget = withVaultSuffix(`${s.familyName ?? "Family"} Family`);
    if (s.familyDocsCandidate) {
      ops.push({ op: "repoint", from: top.id, to: s.familyDocsCandidate.id, what: "Family Vault root" });
      if (s.familyDocsCandidate.name !== FAMILY_DOCS) ops.push({ op: "rename", id: s.familyDocsCandidate.id, from: s.familyDocsCandidate.name, to: FAMILY_DOCS, what: "Family Docs folder" });
    } else {
      ops.push({ op: "create", key: "family-docs", name: FAMILY_DOCS, parent: top.id, what: "Family Docs folder" });
      ops.push({ op: "repoint", from: top.id, to: "", toKey: "family-docs", what: "Family Vault root" });
    }
    if (top.name !== topTarget) ops.push({ op: "rename", id: top.id, from: top.name, to: topTarget, what: "Family folder" });
  }
  if (s.familyFolder && !misrooted) {
    const to = withVaultSuffix(s.familyFolder.name);
    if (to !== s.familyFolder.name) ops.push({ op: "rename", id: s.familyFolder.id, from: s.familyFolder.name, to, what: "Family folder" });
  }
  if (s.familyDocs && !misrooted && s.familyDocs.name !== FAMILY_DOCS) ops.push({ op: "rename", id: s.familyDocs.id, from: s.familyDocs.name, to: FAMILY_DOCS, what: "Family Vault root" });
  for (const h of s.households) {
    const to = withVaultSuffix(isReservedName(h.folder.name) ? `${s.familyName ?? "Household"} Household` : h.folder.name);
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
  : o.op === "repoint" ? `Point the Family Vault at ${o.toKey ? "the new Family Docs folder" : "its Family Docs folder"} (it must not contain the household Vaults)`
  : `Move ${o.what} into Personal Docs`;
