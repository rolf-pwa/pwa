// review-unit-for-contact.ts: which tier, and which set of meetings, apply to a client looking at the portal. A household whose family
// is not bound together (see review-units.ts) sees its own tier and its own meetings; everyone else sees the family's.

import { isPooledFamily } from "./review-units.ts";

// deno-lint-ignore no-explicit-any
type Db = any;

export interface ViewerUnit { householdId: string | null; tier: string | null }

export async function viewerUnit(db: Db, familyId: string, householdId: string | null | undefined): Promise<ViewerUnit> {
  const { data: fam } = await db.from("families").select("service_tier, vfo_enabled, has_ratified_charter, service_tier_source").eq("id", familyId).maybeSingle();
  const familyTier = (fam?.service_tier ?? null) as string | null;
  if (!fam || !householdId || isPooledFamily(fam)) return { householdId: null, tier: familyTier };
  const { data: hh } = await db.from("households").select("service_tier, relationship_ended_at").eq("id", householdId).maybeSingle();
  if (!hh?.service_tier || hh.relationship_ended_at) return { householdId: null, tier: familyTier };
  return { householdId, tier: hh.service_tier as string };
}

/** Limits a review_obligations query to the viewer's own meetings. */
// deno-lint-ignore no-explicit-any
export const scopeToUnit = (q: any, unit: ViewerUnit) => (unit.householdId ? q.eq("household_id", unit.householdId) : q.is("household_id", null));
