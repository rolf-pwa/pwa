// review-unit-for-contact.ts: which tier, and which set of meetings, apply to a client looking at the portal. A household whose family
// is not bound together (see review-units.ts) sees its own tier and its own meetings; everyone else sees the family's.

import { isPooledFamily } from "./review-units.ts";

// deno-lint-ignore no-explicit-any
type Db = any;

export interface ViewerUnit {
  /** Set for a household that stands alone (an unbound family). */
  householdId: string | null;
  tier: string | null;
  /** Set for a household of a bound family (VFO, Charter, hand-set tier): its reviews are its own. */
  reviewHouseholdId?: string | null;
  /** True for the main household of a bound family: a whole-family review made before reviews went per household is its own too. */
  viewsFamilyLevel?: boolean;
}

export async function viewerUnit(db: Db, familyId: string, householdId: string | null | undefined): Promise<ViewerUnit> {
  const { data: fam } = await db.from("families").select("service_tier, vfo_enabled, has_ratified_charter, service_tier_source").eq("id", familyId).maybeSingle();
  const familyTier = (fam?.service_tier ?? null) as string | null;
  if (fam && householdId && isPooledFamily(fam)) {
    const { data: own } = await db.from("households").select("service_tier, relationship_ended_at").eq("id", householdId).maybeSingle();
    if (!own || own.relationship_ended_at) return { householdId: null, tier: familyTier, reviewHouseholdId: null };
    // The main household (the one with the head of the family) has the family's tier and schedule; another household has its own tier.
    const [{ data: heads }, { data: allHeads }] = await Promise.all([
      db.from("contacts").select("id").eq("household_id", householdId).eq("family_role", "head_of_family").limit(1),
      db.from("contacts").select("household_id").eq("family_id", familyId).eq("family_role", "head_of_family").limit(1),
    ]);
    const main = (heads ?? []).length > 0 || (allHeads ?? []).length === 0;
    return { householdId: null, tier: main ? familyTier : ((own.service_tier ?? null) as string | null), reviewHouseholdId: householdId, viewsFamilyLevel: main };
  }
  if (!fam || !householdId) return { householdId: null, tier: familyTier };
  const { data: hh } = await db.from("households").select("service_tier, relationship_ended_at").eq("id", householdId).maybeSingle();
  if (!hh || hh.relationship_ended_at) return { householdId: null, tier: familyTier };
  // A household that stands alone and has no tier (nothing under management, no insurance) owes nothing: it never falls back to the family tier.
  return { householdId, tier: (hh.service_tier ?? null) as string | null };
}

/** Limits a review_obligations query to the viewer's own meetings. */
// deno-lint-ignore no-explicit-any
export const scopeToUnit = (q: any, unit: ViewerUnit) =>
  unit.householdId ? q.eq("household_id", unit.householdId)
    : unit.reviewHouseholdId ? (unit.viewsFamilyLevel ? q.or(`household_id.eq.${unit.reviewHouseholdId},household_id.is.null`) : q.eq("household_id", unit.reviewHouseholdId))
    : q.is("household_id", null);
