// What the Vault reconcile job should do. Pure (no I/O) so it can be unit-tested.
//   * a new adult in a household that has a Vault gets a personal drawer
//   * a new household in a family that already has a Family Vault gets its own Household Vault structure

export interface ReconcileInput {
  households: Array<{ id: string; family_id: string | null; governance_status: string | null; vault_root_folder_id: string | null; members: number }>;
  families: Array<{ id: string; vault_folder_id: string | null }>;
  /** Adults (head of family / household, spouse, adult beneficiary) and whether they already have a personal drawer. */
  adults: Array<{ contact_id: string; household_id: string | null; personal_vault_folder_id: string | null }>;
}

export interface ReconcilePlan {
  /** Households that need personal drawers created, with the adults who lack one. */
  drawers: Array<{ householdId: string; contactIds: string[] }>;
  /** Households that need their Household Vault structure provisioned. */
  newHouseholds: string[];
}

export function planReconcile(i: ReconcileInput): ReconcilePlan {
  const withVault = new Set(i.households.filter((h) => h.vault_root_folder_id).map((h) => h.id));
  const byHousehold = new Map<string, string[]>();
  for (const a of i.adults) {
    if (!a.household_id || a.personal_vault_folder_id || !withVault.has(a.household_id)) continue;
    byHousehold.set(a.household_id, [...(byHousehold.get(a.household_id) ?? []), a.contact_id]);
  }
  const familyHasVault = new Set(i.families.filter((f) => f.vault_folder_id).map((f) => f.id));
  const newHouseholds = i.households
    // "none" is a prospect, not a client: no Drive folders until they are one.
    .filter((h) => !h.vault_root_folder_id && h.family_id && familyHasVault.has(h.family_id) && h.governance_status && h.governance_status !== "none" && h.members > 0)
    .map((h) => h.id);
  return { drawers: [...byHousehold].map(([householdId, contactIds]) => ({ householdId, contactIds })), newHouseholds };
}
