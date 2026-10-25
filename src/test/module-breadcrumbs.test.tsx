// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { moduleOf, withModuleRoot } from "@/shared/lib/moduleHome";
import { PageBreadcrumbs } from "@/shared/components/PageBreadcrumbs";

const D = { label: "Dashboard", href: "/dashboard" };

describe("the first step of a breadcrumb", () => {
  it("is the module the page belongs to, not the Dashboard", () => {
    expect(withModuleRoot([D, { label: "Households" }], "/households")).toEqual([{ label: "CRM", href: "/families" }, { label: "Households" }]);
    expect(withModuleRoot([D, { label: "Family Tree" }], "/families")[0]).toEqual({ label: "CRM", href: "/families" });
    expect(withModuleRoot([D, { label: "Contacts", href: "/contacts" }, { label: "Sam" }], "/contacts/c1")[0].label).toBe("CRM");
    expect(withModuleRoot([D, { label: "Leads" }], "/leads")[0].label).toBe("CRM");
  });
  it("follows the crumb after it when the page's own address says nothing, as the Charter intake does for a household", () => {
    expect(withModuleRoot([D, { label: "Households", href: "/households" }, { label: "Santos", href: "/households/h1" }, { label: "Sovereignty Charter v2.0" }], "/charter-intake/h1").map((c) => c.label)).toEqual(["CRM", "Households", "Santos", "Sovereignty Charter v2.0"]);
  });
  it("does not repeat a module's own list: Pros is Professionals' home, Workbench is its own", () => {
    expect(withModuleRoot([D, { label: "Pros", href: "/professionals" }, { label: "Sarah Jenkins" }], "/professionals/p1").map((c) => c.label)).toEqual(["Pros", "Sarah Jenkins"]);
    expect(withModuleRoot([D, { label: "Workbench", href: "/workbench" }, { label: "Quarterly Review" }], "/quarterly-review/x").map((c) => c.label)).toEqual(["Workbench", "Quarterly Review"]);
    expect(withModuleRoot([D, { label: "Holding Tank" }], "/holding-tank")).toEqual([{ label: "Holding Tank", href: "/holding-tank" }, { label: "Holding Tank" }]);
  });
  it("starts at Today when the page belongs to no module, and leaves any other trail alone", () => {
    expect(withModuleRoot([D, { label: "Something" }], "/somewhere-else")[0]).toEqual({ label: "Today", href: "/briefing" });
    const own = [{ label: "CRM", href: "/families" }, { label: "X" }];
    expect(withModuleRoot(own, "/households")).toBe(own);
    expect(moduleOf("/insurance/abc/needs")?.label).toBe("Insurance");
    expect(moduleOf("/investments")?.home).toBe("/investments");
    expect(moduleOf("/nope")).toBeNull();
  });
});

describe("the breadcrumb on a page", () => {
  it("shows CRM and links to the CRM home", () => {
    render(<MemoryRouter initialEntries={["/households"]}><PageBreadcrumbs items={[D, { label: "Households" }]} /></MemoryRouter>);
    expect(screen.queryByText("Dashboard")).toBeNull();
    expect(screen.getByText("CRM").closest("a")?.getAttribute("href")).toBe("/families");
    expect(screen.getByText("Households").closest("a")).toBeNull(); // the last step is the page itself
  });
  it("no page in the app sends the reader to the Dashboard from its breadcrumb", () => {
    const src = readFileSync("src/shared/components/PageBreadcrumbs.tsx", "utf8");
    expect(src).toContain("withModuleRoot(given, useLocation().pathname)");
  });
});
