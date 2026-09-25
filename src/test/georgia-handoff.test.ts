import { describe, expect, it } from "vitest";
import {
  buildOnboardingIntro,
  CATALYST_TO_SPOKE_NAME,
  SPOKE_TO_WEALTH_EVENT,
} from "../../supabase/functions/_shared/georgia-handoff";
import { CATALYST_SPOKE } from "@/modules/intake/lib/derive";

describe("georgia handoff", () => {
  it("maps every spoke a visitor can reach to an onboarding wealth event", () => {
    const reachable = new Set(Object.values(CATALYST_SPOKE));
    reachable.delete("Emergency_Override");
    for (const spoke of reachable) expect(SPOKE_TO_WEALTH_EVENT[spoke]).toBeTruthy();
  });
  it("keeps the server's catalyst->spoke fallback identical to the client's", () => {
    expect(CATALYST_TO_SPOKE_NAME).toEqual(CATALYST_SPOKE);
  });
  it("builds an intro from spoke and friction, and stays silent without a spoke", () => {
    const intro = buildOnboardingIntro("Inheritance", "internal_paralysis");
    expect(intro).toContain("your inheritance");
    expect(intro).toContain("feeling stuck");
    expect(buildOnboardingIntro("Divorce", null)).toContain("your separation");
    expect(buildOnboardingIntro(null, "family_pressure")).toBeNull();
    expect(buildOnboardingIntro("Emergency_Override", null)).toBeNull();
  });
});
