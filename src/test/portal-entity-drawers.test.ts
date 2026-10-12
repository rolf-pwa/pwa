import { describe, it, expect } from "vitest";
import { sortDrawers } from "@/modules/portal/components/PortalVault";

const d = (kind: any, label: string, rootId = label) => ({ kind, rootId, label, capability: "view" });

describe("portal drawer order with company vaults", () => {
  it("puts Family, Household, Personal first and company vaults last, alphabetically", () => {
    const out = sortDrawers([d("entity", "Smith Opco"), d("personal", "Personal Docs"), d("entity", "Smith Holdco"), d("household", "Household Docs"), d("family", "Family Docs")]);
    expect(out.map((x) => x.label)).toEqual(["Family Docs", "Household Docs", "Personal Docs", "Smith Holdco", "Smith Opco"]);
  });
});
