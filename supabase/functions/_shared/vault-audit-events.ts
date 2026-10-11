// Audit entries written by system processes (no signed-in user), kept pure so they can be unit-tested.

export interface VaultCreatedInput {
  householdId: string;
  rootFolderId: string;
  rootFolderName: string | null;
  categoryFolders: number;
  source: string; // which process created it, e.g. "paid_booking" or "crm_intake_push"
}

/** One entry for a new Vault: the first line of a household's audit file. The folders inside are not logged one by one. */
export function buildVaultCreatedRow(i: VaultCreatedInput) {
  return {
    household_id: i.householdId,
    actor_type: "system",
    actor_id: null,
    actor_label: "system:auto-provision",
    actor_email: null,
    action: "provision",
    drive_id: i.rootFolderId,
    drive_name: i.rootFolderName,
    ip: null,
    user_agent: null,
    metadata: { household_id: i.householdId, auto: true, source: i.source, category_folders: i.categoryFolders },
  };
}
