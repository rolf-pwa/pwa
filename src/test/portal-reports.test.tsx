// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ list: [] as { action: string; body: any }[] }));
vi.mock("@/shared/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: async (_fn: string, { body }: any) => {
    calls.list.push({ action: body.action, body });
    if (body.action === "docList") return { data: { documents: [] }, error: null };
    if (body.action === "docSigned") return { data: { documents: [] }, error: null };
    if (body.action === "reportList") return { data: { reports: [{ id: "r1", title: "Insurance Planning Report", shared_at: "2026-10-24T18:00:00Z" }] }, error: null };
    if (body.action === "reportDownload") return { data: { name: "26-10-24_Example_D_Insurance Planning Report.pdf", base64: btoa("%PDF-1.4 test") }, error: null };
    return { data: {}, error: null };
  } } },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { PortalDocumentsPage, PortalDocumentsTeaser } from "../modules/portal/components/PortalDocuments";

describe("a report the advisor shared, in the client's portal", () => {
  it("is listed on the Documents page with a download, even when nothing is waiting to sign", async () => {
    (globalThis as any).URL.createObjectURL = vi.fn(() => "blob:x"); (globalThis as any).URL.revokeObjectURL = vi.fn();
    render(<PortalDocumentsPage portalToken="tok" onBack={() => {}} />);
    await waitFor(() => expect(screen.getByTestId("shared-reports")).toBeTruthy());
    expect(screen.getByText("Reports from your advisor")).toBeTruthy();
    expect(screen.getByText("Insurance Planning Report")).toBeTruthy();
    fireEvent.click(screen.getByText("Download PDF"));
    await waitFor(() => expect(calls.list.some((c) => c.action === "reportDownload" && c.body.report_id === "r1")).toBe(true));
  });
  it("shows a link on the dashboard even when no document needs signing", async () => {
    render(<PortalDocumentsTeaser portalToken="tok" onOpen={() => {}} />);
    await waitFor(() => expect(screen.getByTestId("documents-signed-link")).toBeTruthy());
    expect(screen.getByText(/1 report from your advisor/)).toBeTruthy();
  });
});

describe("sharing a report", () => {
  const svc = readFileSync("supabase/functions/_shared/planning-report-service.ts", "utf8");
  it("shows it only to the people it was prepared for, and only while it is shared", () => {
    expect(svc).toContain('.not("shared_at", "is", null).contains("contact_ids", [contactId])');
    expect(svc).toContain('!r.shared_at || !((r.contact_ids ?? []) as string[]).includes(contactId)');
  });
  it("tells them once, through the bell and a short email that opens Documents", () => {
    expect(svc).toContain("if (notify && !r.shared_at)");
    expect(svc).toContain('linkTab: "documents"');
    const digest = readFileSync("supabase/functions/process-email-digest/index.ts", "utf8");
    expect(digest).toContain('i.link_tab === "documents"');
    expect(digest).toContain("Your advisor has shared a report with you in your portal.");
    expect(digest).toContain("if (contactId && !documents && !reports)"); // no one-tap link
  });
  it("is reachable from the portal function, the advisor handler and both portals' bells", () => {
    expect(readFileSync("supabase/functions/portal-pm-tasks/index.ts", "utf8")).toContain('action === "reportDownload"');
    const h = readFileSync("supabase/functions/review-agent-admin/index.ts", "utf8");
    expect(h).toContain('"rpShare"'); expect(h).toContain('"rpUnshare"');
    expect(readFileSync("src/modules/portal/pages/Portal.tsx", "utf8")).toContain("onNavigateToDocuments=");
    expect(readFileSync("src/modules/portal/pages/VfoPortal.tsx", "utf8")).toContain('onNavigateToDocuments={() => setTab("documents")}');
    expect(readFileSync("src/modules/portal/components/PortalNotificationBell.tsx", "utf8")).toContain('linkTab === "documents"');
  });
  it("adds the sharing columns", () => {
    const m = readFileSync("supabase/migrations/20261229120000_report_sharing.sql", "utf8");
    expect(m).toContain("shared_at"); expect(m).toContain("shared_by");
  });
});
