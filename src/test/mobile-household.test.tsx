// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/shared/integrations/supabase/client", () => ({ supabase: { functions: { invoke: () => Promise.resolve({ data: { balance: { totalAssets: 1250000, liabilities: 300000, netWorth: 950000 } } }) }, from: () => ({ select: () => ({ eq: () => Promise.resolve({ data: [] }) }) }) } }));
import { HouseholdTotalsStrip } from "@/modules/crm/components/HouseholdTotalsStrip";

describe("the household page on a phone", () => {
  const src = readFileSync("src/modules/crm/pages/HouseholdDetail.tsx", "utf8");

  it("opens each section as the next screen, with the open one in the address so Back returns to the list", () => {
    expect(src).toContain('{...(phone ? { value: section ?? "" } : { defaultValue: "overview" })}');
    expect(src).toContain("const openSection = (value: string) => setSectionParams({ section: value });"); // a new history entry
    expect(src).toContain("{phone && !section && (");
    expect(src).toContain("<MobileSectionList sections={HOUSEHOLD_SECTIONS}");
    expect(src).toContain("{!phone && <TabsList");
    for (const v of ["overview", "vault", "insurance", "actions", "vineyard", "liabilities", "tax", "pros", "analytics"]) expect(src).toContain(`value: "${v}"`);
  });
  it("is the same nine sections as the desktop tabs", () => {
    const tabs = [...src.matchAll(/<TabsTrigger value="([a-z]+)"/g)].map((m) => m[1]);
    const rows = [...src.matchAll(/\{ value: "([a-z]+)", label: "[^"]+", icon:/g)].map((m) => m[1]);
    expect(rows).toEqual(tabs);
  });
  it("starts with the totals, then the members as rows (each with Call and Email) instead of the table, then the sections", () => {
    const home = src.slice(src.indexOf('data-testid="household-phone-home"'), src.indexOf('<Tabs {...(phone'));
    expect(home.indexOf("<HouseholdTotalsStrip")).toBeLessThan(home.indexOf('data-testid="household-phone-members"'));
    expect(home.indexOf('data-testid="household-phone-members"')).toBeLessThan(home.indexOf("<MobileSectionList"));
    expect(home).toContain("dialViaQuo(m.phone)");
    expect(home).toContain("mailto:${m.email}");
    expect(home).toContain("min-h-14");
    expect(src).toContain("{!phone && <Card>"); // the wide members table is desktop only
  });
  it("leaves the setup fields (address block, governance status, fiduciary entity, quiet period) and the onboarding link to the desktop, keeping the address as a line", () => {
    expect(src).toContain('className="mt-4 hidden gap-4 md:grid md:grid-cols-2 lg:grid-cols-4" data-testid="household-setup-fields"');
    expect(src).toContain('<div className="mt-4 hidden md:block"><OnboardingInviteCard');
    expect(src).toContain('data-testid="household-phone-address"');
    expect(src).toContain("md:hidden");
  });
  it("has no back arrow in the header on a phone, hides the header while a section is open, and gives the actions their own full-width row", () => {
    expect(src).toContain('className="-ml-2 hidden shrink-0 md:inline-flex"');
    expect(src).toContain('<Card className={phone && section ? "hidden" : undefined}>');
    expect(src).toContain("flex w-full items-center gap-2 md:w-auto md:shrink-0");
    expect(src).toContain('className="h-11 md:h-10"');
  });
});

describe("the totals on a phone", () => {
  it("are three compact columns that fit, and larger on a desktop", async () => {
    render(<HouseholdTotalsStrip householdId="h1" />);
    expect(await screen.findByText("$1,250,000")).toBeTruthy();
    const value = screen.getByText("$1,250,000");
    expect(value.className).toContain("text-sm");
    expect(value.className).toContain("md:text-lg");
    expect(value.parentElement?.parentElement?.className).toContain("grid-cols-3");
    expect(value.parentElement?.parentElement?.className).toContain("gap-2");
  });
  it("are the same in the contact's strip", () => {
    const s = readFileSync("src/modules/crm/components/ContactTotalsStrip.tsx", "utf8");
    expect(s).toContain("grid grid-cols-3 gap-2");
    expect(s).toContain("text-sm font-semibold tabular-nums md:text-lg");
  });
});

describe("the households list on a phone", () => {
  it("lets the two filters take the full width instead of squeezing beside the search", () => {
    const s = readFileSync("src/modules/crm/pages/Households.tsx", "utf8");
    expect(s.match(/<SelectTrigger className="w-full sm:w-44">/g)).toHaveLength(2);
  });
});

describe("date fields on a phone", () => {
  it("stay inside their card", () => {
    expect(readFileSync("src/index.css", "utf8")).toMatch(/input\[type="date"\][^{]*\{ min-width: 0; max-width: 100%; box-sizing: border-box; \}/);
  });
});
