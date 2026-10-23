import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { RETENTION_YEARS, isFormer, keepUntil, keepUntilLabel, retentionOver } from "@/shared/lib/retention";

const read = (p: string) => readFileSync(p, "utf8");

describe("the 7-year rule", () => {
  it("is seven years from the end of the relationship", () => {
    expect(RETENTION_YEARS).toBe(7);
    expect(keepUntil("2026-08-26T12:00:00Z").toISOString().slice(0, 10)).toBe("2033-08-26");
    expect(keepUntilLabel("2026-10-01T12:00:00Z")).toBe("October 2033");
  });
  it("is over only once the 7 years have passed", () => {
    expect(retentionOver("2026-08-26T12:00:00Z", new Date("2033-08-25T12:00:00Z"))).toBe(false);
    expect(retentionOver("2026-08-26T12:00:00Z", new Date("2033-08-27T12:00:00Z"))).toBe(true);
  });
  it("calls a household a former client once its relationship has ended", () => {
    expect(isFormer({ relationship_ended_at: "2026-08-26T00:00:00Z" })).toBe(true);
    expect(isFormer({ relationship_ended_at: null })).toBe(false);
    expect(isFormer(null)).toBe(false);
  });
});

describe("the delete guard", () => {
  const m = read("supabase/migrations/20261224120000_retention_delete_guard.sql");
  it("guards households, people and families, and nothing else is deleted by it", () => {
    for (const t of ["households", "contacts", "families"]) expect(m).toContain(`BEFORE DELETE ON public.${t} FOR EACH ROW EXECUTE FUNCTION public.guard_regulated_delete()`);
    expect(m).not.toMatch(/DELETE FROM/i);
  });
  it("lets a relationship that ended 7 or more years ago go, and refuses otherwise when records exist", () => {
    expect(m).toContain("ended <= now() - interval '7 years'");
    expect(m).toContain("must be kept for 7 years after the advisory relationship ends");
    expect(m).toContain("End the relationship instead");
  });
  it("covers the records that matter, and leaves out tokens, notifications and workflow plumbing", () => {
    for (const t of ["insurance_files", "insurance_documents", "insurance_fact_finds", "insurance_quotes", "insurance_needs_analyses", "insurance_policies", "liabilities", "storehouses", "sovereignty_charters", "investor_profiles", "portfolio_review_publications", "governance_audits"]) expect(m, t).toContain(`'${t}'`);
    for (const t of ["portal_tokens", "portal_otps", "staff_notifications", "insurance_pipeline", "onboarding_invites"]) expect(m, t).not.toContain(`'${t}'`);
  });
  it("has a documented break-glass for a court order or a privacy request", () => {
    expect(m).toContain("app.allow_regulated_delete");
  });
  it("shows staff the reason when a delete is refused", () => {
    const f = read("src/modules/crm/pages/Families.tsx");
    expect(f.match(/must be kept for 7 years/g)?.length).toBe(2);
  });
});

describe("former clients", () => {
  it("are out of the main Contacts, Families and Households lists and the task picker", () => {
    expect(read("src/modules/crm/pages/Contacts.tsx")).toContain("!isFormer(c.households)");
    expect(read("src/modules/crm/pages/Families.tsx")).toContain("allEnded");
    expect(read("src/modules/crm/pages/Households.tsx")).toContain("filter((hh: any) => !isFormer(hh))");
    expect(read("src/modules/pm/components/EntityPicker.tsx")).toContain('.is("relationship_ended_at", null)');
  });
  it("have a page of their own, behind login, with a quiet link rather than a tab", () => {
    expect(read("src/App.tsx")).toMatch(/path="\/former-clients" element=\{<ProtectedRoute><FormerClients \/><\/ProtectedRoute>\}/);
    const tabs = read("src/modules/crm/components/CrmTabs.tsx");
    expect(tabs).toContain('to="/former-clients"');
    expect(tabs).not.toMatch(/\{ label: "Former clients"/);
    const page = read("src/modules/crm/pages/FormerClients.tsx");
    expect(page).toContain('.not("relationship_ended_at", "is", null)');
    expect(page).toContain("kept until");
  });
  it("tell the advisor what ending a relationship does, and show the keep-until date", () => {
    const h = read("src/modules/crm/pages/HouseholdDetail.tsx");
    expect(h).toContain("moves out of the main CRM lists");
    expect(h).toContain("Records kept until");
    expect(h).not.toContain("does not delete or hide any data");
  });
});
