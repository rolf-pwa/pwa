import { describe, expect, it } from "vitest";
import { makeVisibilityFilter } from "../../supabase/functions/_shared/portal-visibility";

const row = (contact_id: string | null, scope: string) => ({ contact_id, visibility_scope: scope });

describe("what the portal sends about other people", () => {
  const householdOf = new Map<string, string | null>([["me", "h1"], ["spouse", "h1"], ["cousin", "h2"]]);
  const visible = makeVisibilityFilter("me", "h1", householdOf);

  it("always sends the viewer's own rows, whatever their scope", () => {
    for (const s of ["private", "household_shared", "family_shared"]) expect(visible(row("me", s))).toBe(true);
  });
  it("sends a fellow household member's rows only when shared with the household or the family", () => {
    expect(visible(row("spouse", "private"))).toBe(false);
    expect(visible(row("spouse", "household_shared"))).toBe(true);
    expect(visible(row("spouse", "family_shared"))).toBe(true);
  });
  it("sends a sibling household's rows only when shared with the whole family", () => {
    expect(visible(row("cousin", "private"))).toBe(false);
    expect(visible(row("cousin", "household_shared"))).toBe(false);
    expect(visible(row("cousin", "family_shared"))).toBe(true);
  });
  it("treats an unknown owner as outside the household, and keeps rows with no individual owner (corporate)", () => {
    expect(visible(row("stranger", "household_shared"))).toBe(false);
    expect(visible(row(null, "private"))).toBe(true);
  });
  it("treats a missing or unexpected scope as private", () => {
    expect(visible({ contact_id: "spouse" })).toBe(false);
    expect(visible(row("spouse", "something_else"))).toBe(false);
  });
});
