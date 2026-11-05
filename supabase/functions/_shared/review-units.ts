// review-units.ts: who owes a meeting. Pure (no I/O) so it can be unit-tested.
//
// A family that is bound together (a ratified Charter, a Virtual Family Office, or a tier Rolf set by hand) has one pooled tier, the family's.
// Only its main household, the one with the head of the family, gets the full schedule on that tier (Rolf, 2026-11-05). Its other households
// are their own units on their own tier, worked out from their own assets, until they reach VFO status of their own. Each unit is a household, so
// each has its own portfolio review and rebalancing with a household pack and engine proposal (before that the whole family was one unit, which
// left a household of the family with no household pack of its own). A family with no binding is not one entity: each household that still has an
// advisory relationship is its own unit, tiered on its own assets (Rolf, 2026-10-14). A household with nothing under management and no insurance
// has no tier and owes no meetings; one with insurance only is Tier 0, which has no scheduled review either.

export interface UnitFamily { id: string; name: string; service_tier: string | null; vfo_enabled?: boolean | null; has_ratified_charter?: boolean | null; service_tier_source?: string | null }
export interface UnitHousehold { id: string; family_id: string; label: string | null; service_tier: string | null; relationship_ended_at: string | null }

export interface ReviewUnit {
  /** "familyId" for a whole family kept as one unit (nothing recorded under any of its households), "familyId|householdId" for a household. */
  key: string;
  familyId: string;
  householdId: string | null;
  /** What staff see: the family, plus the household when it stands alone. */
  name: string;
  tier: string;
  /** True for the main household of a bound family: it takes the family's tier and its full schedule. */
  main?: boolean;
}

export const unitKey = (familyId: string, householdId: string | null) => (householdId ? `${familyId}|${householdId}` : familyId);

/** True when the family is tiered as a whole. */
export const isPooledFamily = (f: Pick<UnitFamily, "vfo_enabled" | "has_ratified_charter" | "service_tier_source">) =>
  Boolean(f.has_ratified_charter || f.vfo_enabled || f.service_tier_source === "manual_override");

/** The households that hold a head of the family: the main household of a bound family. */
export function mainHouseholdIds(contacts: { household_id: string | null; family_role: string | null }[]): Set<string> {
  return new Set(contacts.filter((c) => c.family_role === "head_of_family" && c.household_id).map((c) => c.household_id as string));
}

/**
 * Of a bound family, the main household takes the family's tier; each other household that has something recorded under it (an account or a
 * policy, per `holdsAssets`) is a unit on its own tier and owes nothing until it has one. When no household holds a head of the family, every
 * household takes the family's tier, so nobody is left without a schedule. A bound family where nothing is recorded under any household stays one unit.
 */
export function reviewUnits(families: UnitFamily[], households: UnitHousehold[], holdsAssets?: ReadonlySet<string>, mains?: ReadonlySet<string>): ReviewUnit[] {
  const out: ReviewUnit[] = [];
  for (const f of families) {
    const mine = households.filter((h) => h.family_id === f.id);
    const active = mine.filter((h) => !h.relationship_ended_at);
    // A family whose households have all ended their advisory relationship owes nothing.
    if (mine.length && !active.length) continue;
    if (isPooledFamily(f)) {
      if (!f.service_tier) continue;
      const anyMain = !!mains && active.some((h) => mains.has(h.id));
      const isMain = (h: UnitHousehold) => !mains || !anyMain || mains.has(h.id);
      const owners = active.filter((h) => isMain(h) || !holdsAssets || holdsAssets.has(h.id));
      if (!owners.length) { out.push({ key: unitKey(f.id, null), familyId: f.id, householdId: null, name: f.name, tier: f.service_tier }); continue; }
      for (const h of owners) {
        const main = isMain(h);
        // The main household takes the family's tier; another household's own tier is worked out from its own assets, and none means nothing is owed.
        const tier = main ? f.service_tier : h.service_tier;
        if (!tier) continue;
        out.push({ key: unitKey(f.id, h.id), familyId: f.id, householdId: h.id, name: active.length > 1 ? `${f.name}: ${h.label ?? "household"}` : f.name, tier, main });
      }
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

export interface ExistingObligation { family_id: string; household_id: string | null; window_key: string; status: string; published_at?: string | null }

/**
 * Whole-family obligations made before reviews went per household that are still in flight (booked, held, escalated, paused, or already published
 * to the client). The household-level obligation for the same window is not made, so a family is never owed the same review twice, and these keep
 * working until they are done.
 */
export function familyLevelInFlight(existing: ExistingObligation[]): Set<string> {
  return new Set(existing.filter((o) => !o.household_id && o.status !== "cancelled" && (o.status !== "open" || !!o.published_at)).map((o) => `${o.family_id}|${o.window_key}`));
}

/** An open obligation nobody owes any more is cancelled; one already published to the client never is. */
export const cancellable = (o: ExistingObligation, wanted: ReadonlySet<string>): boolean =>
  o.status === "open" && !o.published_at && !wanted.has(`${unitKey(o.family_id, o.household_id)}|${o.window_key}`);
