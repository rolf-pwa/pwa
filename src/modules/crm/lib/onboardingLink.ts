interface HouseholdState { governance_status?: string | null; onboarding_enabled?: boolean | null; onboarding_completed_at?: string | null; relationship_ended_at?: string | null }

/**
 * Whether the household's page offers the onboarding link. An active household (in a governance phase, onboarding not under way) does not need one,
 * and neither does one whose onboarding is complete or whose relationship has ended. A new household, or one being onboarded now, does.
 */
export function needsOnboardingLink(h: HouseholdState): boolean {
  if (h.relationship_ended_at || h.onboarding_completed_at) return false;
  const phase = h.governance_status && h.governance_status !== "none";
  return !phase || h.onboarding_enabled === true;
}
