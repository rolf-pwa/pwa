import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync("src/modules/crm/pages/HouseholdDetail.tsx", "utf8");
const tools = readFileSync("src/modules/crm/components/HouseholdWorkbench.tsx", "utf8");

describe("the household's tools", () => {
  it("are one card at the top of the sidebar, rendered once", () => {
    expect(page).toContain("                {workbench}\n");
    expect(page).not.toContain("{!phone && workbench}");
    expect(page).not.toContain("{phone && workbench}");
    expect((page.match(/<HouseholdWorkbench/g) ?? []).length).toBe(1);
  });
  it("are called Household tools and show only buttons, full width and stacked, with the explanation on hover", () => {
    expect(tools).toContain("Household tools");
    expect(tools).not.toContain("sm:grid-cols-2");
    expect(tools).toContain('const GRID = "grid gap-2"');
    expect(tools).toContain("title={body}");
    expect(tools).toContain("[&_button]:w-full");
    expect(tools).not.toMatch(/<p className="[^"]*">\{title\}<\/p>/);
  });
});

describe("the household's sidebar", () => {
  it("no longer carries the Charter Ratification, Cashflow Analyst or Professional Team cards", () => {
    expect(page).not.toContain("<CharterRatificationTile");
    expect(page).not.toContain("Analyze the True Burn Rate");
    expect(page).not.toContain('title="Professional Team"');
    // The Cashflow Analyst stays one click away in More Actions.
    expect(page).toContain("Cashflow Analyst");
  });
});

describe("the Georgia diagnostic on the household page", () => {
  it("shows only for a new or onboarding household, by the same rule as the onboarding link", () => {
    expect(page).toContain('{needsOnboardingLink(household) && <SidebarSection title="Georgia Diagnostic">');
  });
});
