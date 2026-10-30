// Other assets (principal residence, vehicles, collectibles...): categories, owner splits and the stale-value check.
// Pure; no I/O.

export const OTHER_ASSET_CATEGORIES = [
  { value: "principal_residence", label: "Principal residence" },
  { value: "other_property", label: "Other property" },
  { value: "vehicle", label: "Vehicle" },
  { value: "boat_rv", label: "Boat or RV" },
  { value: "valuables", label: "Art, jewellery or collectibles" },
  { value: "other", label: "Other" },
] as const;

export const categoryLabel = (v: string) => OTHER_ASSET_CATEGORIES.find((c) => c.value === v)?.label ?? "Other";

export interface OwnerShare { contact_id: string; ownership_pct: number }

/** Owner splits must name at least one owner, have no repeats, and add up to exactly 100. Returns a message, or null when fine. */
export function ownerSplitError(owners: OwnerShare[]): string | null {
  if (owners.length === 0) return "Choose at least one owner.";
  if (new Set(owners.map((o) => o.contact_id)).size !== owners.length) return "Each owner can only appear once.";
  if (owners.some((o) => !(o.ownership_pct > 0 && o.ownership_pct <= 100))) return "Each share must be between 0 and 100.";
  const total = owners.reduce((s, o) => s + o.ownership_pct, 0);
  return Math.abs(total - 100) < 0.005 ? null : `Shares add up to ${Math.round(total * 100) / 100}%, not 100%.`;
}

/** An even split, with any rounding left on the first owner so the total is exactly 100. */
export function evenSplit(contactIds: string[]): OwnerShare[] {
  if (contactIds.length === 0) return [];
  const each = Math.floor((10000 / contactIds.length)) / 100;
  const first = Math.round((100 - each * (contactIds.length - 1)) * 100) / 100;
  return contactIds.map((id, i) => ({ contact_id: id, ownership_pct: i === 0 ? first : each }));
}

/** A contact's share of an asset's value (their % of the full value). */
export const shareOfValue = (value: number | null, pct: number) => (value === null ? null : Math.round(value * pct) / 100);

export const isJoint = (owners: OwnerShare[]) => owners.length > 1;

/** True when a value has no date or is more than 12 months old. */
export function valueIsStale(asOf: string | null, today: string = new Date().toISOString().slice(0, 10)): boolean {
  if (!asOf) return true;
  const d = new Date(asOf);
  if (Number.isNaN(d.getTime())) return true;
  const cutoff = new Date(today);
  cutoff.setFullYear(cutoff.getFullYear() - 1);
  return d < cutoff;
}
