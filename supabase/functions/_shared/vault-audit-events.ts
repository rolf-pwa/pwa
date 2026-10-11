// Audit entries written by system processes (no signed-in user), kept pure so they can be unit-tested.

export interface VaultCreatedInput {
  householdId: string;
  rootFolderId: string;
  rootFolderName: string | null;
  categoryFolders: number;
  source: string; // which process created it, e.g. "paid_booking" or "crm_intake_push"
  familyId?: string | null;
  /** True when this run also created the Family Vault (Family Docs) for the family. */
  familyDocsCreated?: boolean;
  personalDrawers?: number;
  /** A signed-in staff member who asked for it; otherwise it is a system action. */
  requestedBy?: { id: string; email: string | null } | null;
}

/** One entry for a new Vault: the first line of a household's audit file. The folders inside are not logged one by one. */
export function buildVaultCreatedRow(i: VaultCreatedInput) {
  return {
    household_id: i.householdId,
    actor_type: i.requestedBy ? "staff" : "system",
    actor_id: i.requestedBy?.id ?? null,
    actor_label: i.requestedBy ? "staff" : "system:auto-provision",
    actor_email: i.requestedBy?.email ?? null,
    action: "provision",
    drive_id: i.rootFolderId,
    drive_name: i.rootFolderName,
    ip: null,
    user_agent: null,
    metadata: {
      household_id: i.householdId, auto: !i.requestedBy, source: i.source, category_folders: i.categoryFolders,
      ...(i.familyId ? { family_id: i.familyId } : {}),
      ...(i.familyDocsCreated ? { family_docs_created: true } : {}),
      ...(i.personalDrawers ? { personal_drawers: i.personalDrawers } : {}),
    },
  };
}

/** One entry for a personal drawer created for an adult (by the reconcile job or a household provision). */
export function buildPersonalDrawerRow(i: { householdId: string; familyId: string | null; contactId: string; folderId: string; folderName: string | null; source: string }) {
  return {
    household_id: i.householdId, contact_id: i.contactId, actor_type: "system", actor_id: null, actor_label: "system:auto-provision", actor_email: null,
    action: "provision", drive_id: i.folderId, drive_name: i.folderName, ip: null, user_agent: null,
    metadata: { household_id: i.householdId, ...(i.familyId ? { family_id: i.familyId } : {}), drawer: "personal", owner_contact_id: i.contactId, auto: true, source: i.source },
  };
}
