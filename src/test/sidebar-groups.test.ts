import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GROUPS } from "@/shared/components/AppSidebar";
import { screenOf } from "@/shared/lib/pageViews";

// Every screen that was in the sidebar before it was reorganised: none may be lost, only moved.
const BEFORE = ["/dashboard", "/inbox", "/projects", "/team-capacity", "/invoices", "/services", "/families", "/pipeline", "/insurance", "/investments", "/holding-tank", "/professionals",
  "/briefing", "/workbench", "/onboarding-agent", "/review-agent", "/ask-georgia", "/review-queue", "/glass-box-review", "/bulk-statement-import", "/vault-audit", "/knowledge-base",
  "/analytics", "/admin/vfo", "/onboarding", "/importers", "/webforms"];
const all = GROUPS.flatMap((g) => g.items.map((i) => i.to as string));

describe("the sidebar", () => {
  it("keeps every screen it had, each once", () => {
    for (const to of BEFORE) expect(all.filter((x) => x === to), to).toHaveLength(1);
    expect(new Set(all).size).toBe(all.length);
  });
  it("starts with a short Daily group with Today (Georgia) first, and what needs attention marked", () => {
    const daily = GROUPS[0];
    expect(daily.key).toBe("daily");
    expect(daily.items.map((i) => i.label)).toEqual(["Today (Georgia)", "Inbox", "CRM", "Ask Georgia", "Pipeline", "Insurance", "Investments", "Projects", "Dashboard"]);
    expect((daily.items as readonly any[]).filter((i) => i.badgeKey).map((i) => i.badgeKey)).toEqual(["inbox", "requests"]);
    // The Review Queue is in the back office but keeps its count: the back office icon shows a dot when something is waiting.
    expect((GROUPS.find((g) => g.key === "backoffice")!.items as readonly any[]).find((i) => i.to === "/review-queue")?.badgeKey).toBe("review");
  });
  it("moves setup, imports, logs and the agents' own screens out of the way", () => {
    const back = GROUPS.find((g) => g.key === "backoffice")!.items.map((i) => i.to);
    for (const to of ["/bulk-statement-import", "/importers", "/webforms", "/vault-audit", "/workbench", "/knowledge-base", "/onboarding-agent", "/review-agent", "/glass-box-review", "/onboarding"]) expect(back).toContain(to);
    const daily = GROUPS[0].items.map((i) => i.to as string);
    for (const to of back) expect(daily).not.toContain(to);
    expect(GROUPS.map((g) => g.key)).toEqual(["daily", "business", "backoffice"]);
  });
  it("forgets a remembered group from the old layout and signs in to Today", () => {
    const src = readFileSync("src/shared/components/AppSidebar.tsx", "utf8");
    expect(src).toContain('stored === "more" || GROUPS.some((g) => g.key === stored)');
    expect(readFileSync("src/pages/AuthCallback.tsx", "utf8")).not.toContain('setDestination("/dashboard")');
  });
});

describe("the page-view log", () => {
  it("names a screen without ids or tokens, so every household's page is the same screen", () => {
    expect(screenOf("/households/3f2a8c1e-1b2c-4d5e-8f90-0123456789ab")).toBe("/households/:id");
    expect(screenOf("/insurance/3f2a8c1e-1b2c-4d5e-8f90-0123456789ab/Needs")).toBe("/insurance/:id/needs");
    expect(screenOf("/portal/fd1819f600c15d486b89de23d6627dfd332ed68a27306532ba693687b1f199b5")).toBe("/portal/:id");
    expect(screenOf("/briefing")).toBe("/briefing");
    expect(screenOf("/")).toBe("/");
    expect(screenOf("/x/" + "a".repeat(400)).length).toBeLessThanOrEqual(200);
  });
  it("is recorded from the layout, ignoring failures, with a table staff can only add their own rows to", () => {
    const layout = readFileSync("src/shared/components/AppLayout.tsx", "utf8");
    expect(layout).toContain('supabase.from("staff_page_views" as any)');
    expect(layout).toContain("lastScreen.current");
    const m = readFileSync("supabase/migrations/20270103120000_staff_page_views.sql", "utf8");
    expect(m).toContain("GRANT INSERT ON public.staff_page_views TO authenticated");
    expect(m).toContain("GRANT ALL ON public.staff_page_views TO service_role");
    expect(m).toContain("WITH CHECK (user_id = auth.uid())");
    expect(m).not.toMatch(/GRANT SELECT[^;]*TO authenticated/);
  });
});

describe("where staff land", () => {
  it("is Today from every way in: the sign-in page, the Google callback, the root address, and the workspaces' back links", () => {
    expect(readFileSync("src/shared/lib/staffHome.ts", "utf8")).toContain('STAFF_HOME = "/briefing"');
    for (const f of ["src/pages/Login.tsx", "src/pages/GoogleCallback.tsx", "src/pages/AuthCallback.tsx", "src/modules/insurance/InsuranceLayout.tsx", "src/modules/investments/InvestmentLayout.tsx"]) {
      const s = readFileSync(f, "utf8");
      expect(s, f).toContain("STAFF_HOME");
      expect(s, f).not.toMatch(/(navigate\(|Navigate to=|setDestination\()\s*\{?\s*["`]\/dashboard["`]/);
      expect(s, f).not.toContain(': "/dashboard"');
    }
  });
});
