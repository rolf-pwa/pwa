import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync("src/modules/crm/pages/HouseholdDetail.tsx", "utf8");
const tools = readFileSync("src/modules/crm/components/HouseholdWorkbench.tsx", "utf8");

describe("the household's tools", () => {
  it("sit in a strip under the header on a desktop, not in the side column, and stay in the Overview on a phone", () => {
    expect(page).toContain("{!phone && workbench}");
    expect(page).toContain("{phone && workbench}");
    expect(page.indexOf("{!phone && workbench}")).toBeLessThan(page.indexOf("{/* Tabs */}"));
    expect((page.match(/<HouseholdWorkbench/g) ?? []).length).toBe(1);
  });
  it("are called Household tools, show a title and a button without the explanatory paragraph, and spread across columns", () => {
    expect(tools).toContain("Household tools");
    expect(tools).not.toContain("AI Workbench</CardTitle>");
    expect(tools).not.toContain("What applies to this household right now");
    expect(tools).toContain("sm:grid-cols-2 xl:grid-cols-3");
    expect(tools).toContain("title={body}");
    expect(tools).not.toMatch(/<p className="text-xs text-muted-foreground">\{body\}<\/p>/);
  });
});
