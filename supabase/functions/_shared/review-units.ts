// review-units.ts: who owes a meeting. Pure (no I/O) so it can be unit-tested.
//
// A family that is bound together (a ratified Charter, a Virtual Family Office, or a tier Rolf set by hand) is one unit: its tier is
// pooled and it owes one set of meetings. A family with no such binding is not one entity: each household that still has an advisory
// relationship is its own unit, tiered on its own assets (Rolf, 2026-10-14). A household with nothing under management and no insurance
// has no tier and owes no meetings; one with insurance only is Tier 0, which has no scheduled review either.

export interface UnitFamily { id: string; name: string; service_tier: string | null; vfo_enabled?: boolean | null; has_ratified_charter?: boolean | null; service_tier_source?: string | null }
export interface UnitHousehold { id: string; family_id: string; label: string | null; service_tier: string | null; relationship_ended_at: string | null }

export interface ReviewUnit {
  /** "familyId" for a pooled family, "familyId|householdId" for a household that stands alone. */
  key: string;
  familyId: string;
  householdId: string | null;
  /** What staff see: the family, plus the household when it stands alone. */
  name: string;
  tier: string;
}

export const unitKey = (familyId: string, householdId: string | null) => (householdId ? `${familyId}|${householdId}` : familyId);

/** True when the family is tiered as a whole. */
export const isPooledFamily = (f: Pick<UnitFamily, "vfo_enabled" | "has_ratified_charter" | "service_tier_source">) =>
  Boolean(f.has_ratified_charter || f.vfo_enabled || f.service_tier_source === "manual_override");

export function reviewUnits(families: UnitFamily[], households: UnitHousehold[]): ReviewUnit[] {
  const out: ReviewUnit[] = [];
  for (const f of families) {
    const mine = households.filter((h) => h.family_id === f.id);
    const active = mine.filter((h) => !h.relationship_ended_at);
    // A family whose households have all ended their advisory relationship owes nothing.
    if (mine.length && !active.length) continue;
    if (isPooledFamily(f)) {
      if (f.service_tier) out.push({ key: unitKey(f.id, null), familyId: f.id, householdId: null, name: f.name, tier: f.service_tier });
      continue;
    }
    if (!active.length) {
      if (f.service_tier) out.push({ key: unitKey(f.id, null), familyId: f.id, householdId: null, name: f.name, tier: f.service_tier });
      continue;
    }
    for (const h of active) {
      if (!h.service_tier) continue;
      out.push({ key: unitKey(f.id, h.id), familyId: f.id, householdId: h.id, name: active.length > 1 ? `${f.name}: ${h.label ?? "household"}` : f.name, tier: h.service_tier });
    }
  }
  return out;
}

/** The tier shown for a family: the pooled tier, or the highest of its households that stand alone. */
export function familyDisplayTier(householdTiers: string[]): string | null {
  const order = ["tier_0", "tier_1", "tier_2a", "tier_2b", "tier_3", "tier_4"];
  const known = householdTiers.filter((t) => order.includes(t));
  if (!known.length) return null;
  return known.reduce((a, b) => (order.indexOf(b) > order.indexOf(a) ? b : a));
}
