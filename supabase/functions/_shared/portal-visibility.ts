// Privacy firewall, enforced here and not only on the page: what the portal sends about OTHER people. The viewer sees
// everything of their own; fellow members of their household only what is marked household_shared or family_shared;
// members of a sibling household (family head only) only what is marked family_shared. Private stays private.
const HOUSEHOLD_VISIBLE = new Set(["household_shared", "family_shared"]);
const FAMILY_VISIBLE = new Set(["family_shared"]);
export function makeVisibilityFilter(viewerId: string, viewerHouseholdId: string | null, householdOf: Map<string, string | null>) {
  return (row: any): boolean => {
    const owner = row?.contact_id;
    if (!owner || owner === viewerId) return true; // own rows, and rows with no individual owner (corporate)
    const allowed = householdOf.get(owner) && householdOf.get(owner) === viewerHouseholdId ? HOUSEHOLD_VISIBLE : FAMILY_VISIBLE;
    return allowed.has(String(row.visibility_scope));
  };
}
