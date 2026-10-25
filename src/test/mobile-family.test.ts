import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const detail = readFileSync("src/modules/crm/pages/FamilyDetail.tsx", "utf8");
const list = readFileSync("src/modules/crm/pages/Families.tsx", "utf8");
const panel = readFileSync("src/modules/crm/components/families/DetailPanel.tsx", "utf8");

describe("the Family pages on a phone", () => {
  it("stacks the family's two columns on a phone, households first, and puts them side by side from a tablet up", () => {
    expect(detail).toContain('"flex flex-col gap-4 md:flex-row md:items-start"');
    expect(detail).toMatch(/data-testid="family-sidebar"/);
    expect(detail).toContain("order-2 w-full shrink-0 space-y-4 md:order-1 md:w-80");
    expect(detail).toContain("order-1 w-full min-w-0 flex-1 space-y-6 md:order-2");
    expect(detail).not.toContain('className="w-80 shrink-0 space-y-4"');
  });
  it("opens the family tree's details in a bottom sheet on a phone, and keeps the side panel on a desktop", () => {
    expect(list).toContain("phone ? (");
    expect(list).toContain("<BottomSheetContent");
    expect(list).toContain("embedded");
    expect(panel).toContain("w-[400px]");
    expect(panel).toContain("embedded ?");
  });
});

describe("the households on a phone", () => {
  it("lets a household and a member name wrap on its own line, with the badge, amount and Open below, instead of cutting names to an initial", () => {
    expect(detail).toContain('data-testid="household-row"');
    expect(detail).toContain("basis-full");
    expect(detail).toContain("break-words font-medium sm:truncate");
    expect(detail).toContain('data-testid="member-row"');
    expect(detail).toContain("break-words text-sm font-medium hover:underline sm:flex-1 sm:basis-0 sm:truncate");
    expect(detail).toContain("whitespace-nowrap");
    expect(detail).not.toContain("shrink-0 w-32 text-right");
  });
});
