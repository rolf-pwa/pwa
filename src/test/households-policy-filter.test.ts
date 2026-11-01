import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const src = readFileSync("src/modules/crm/pages/Households.tsx", "utf8");

describe("Households page: the insurance filter", () => {
  it("reads policies and marks a household as covered when any member has one", () => {
    expect(src).toContain('supabase.from("insurance_policies").select("contact_id")');
    expect(src).toContain("contactHouseholdMap.get(p.contact_id)");
    expect(src).toContain("hasPolicy: householdsWithPolicy.has(hh.id)");
  });
  it("offers no policy on file and has a policy, and clears with the other filters", () => {
    expect(src).toContain('<SelectItem value="none">No policy on file</SelectItem>');
    expect(src).toContain('<SelectItem value="has">Has a policy on file</SelectItem>');
    expect(src).toContain('policyFilter === "none" ? !hh.hasPolicy : hh.hasPolicy');
    expect(src).toContain('setPolicyFilter("all")');
  });
});
