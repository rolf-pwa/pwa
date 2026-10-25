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
