import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { needsOnboardingLink } from "@/modules/crm/lib/onboardingLink";

describe("who is offered the onboarding link", () => {
  it("does not offer it for an active household", () => {
    for (const governance_status of ["core", "stabilization", "sovereign"]) expect(needsOnboardingLink({ governance_status, onboarding_enabled: false }), governance_status).toBe(false);
  });
  it("offers it for a new household, or one whose onboarding is under way", () => {
    expect(needsOnboardingLink({ governance_status: "none" })).toBe(true);
    expect(needsOnboardingLink({ governance_status: null })).toBe(true);
    expect(needsOnboardingLink({ governance_status: "stabilization", onboarding_enabled: true })).toBe(true);
  });
  it("never offers it once onboarding is complete or the relationship has ended", () => {
    expect(needsOnboardingLink({ governance_status: "none", onboarding_completed_at: "2026-10-01" })).toBe(false);
    expect(needsOnboardingLink({ governance_status: "none", relationship_ended_at: "2026-10-01" })).toBe(false);
  });
  it("puts the link in More Actions on the desktop", () => {
    const src = readFileSync("src/modules/crm/pages/HouseholdDetail.tsx", "utf8");
    expect(src).toContain("const showInvite = !phone && needsOnboardingLink(household)");
    expect(src).toContain("{showInvite && (");
    expect(src).toContain("<Link2 className=\"mr-2 h-4 w-4\" /> Onboarding link");
  });
});
