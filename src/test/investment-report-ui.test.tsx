// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ previews: [] as any[], files: [] as any[], shares: [] as unknown[][], unshares: [] as unknown[][] }));
vi.mock("@/modules/crm/lib/reviewAgent", () => ({
  getInvestmentRecs: async () => ({ models: [], people: [{ id: "a", name: "Justin Santos", riskProfile: "balanced", suggestedReason: "", rec: { id: "r" } }, { id: "b", name: "Lisa Santos", riskProfile: null, suggestedReason: "", rec: null }] }),
  getInvestmentReports: async () => ({ reports: [
    { id: "x1", title: "Investment Recommendation Report", contact_ids: ["a"], include_funds: true, pdf_url: "https://d/1", pdf_name: "26-10-24_Santos_J_Investment Recommendation Report.pdf", created_by: "r", created_at: "2026-10-24T20:00:00Z", shared_at: null },
    { id: "x2", title: "Investment Recommendation Report", contact_ids: ["a"], include_funds: false, pdf_url: "https://d/2", pdf_name: "older.pdf", created_by: "r", created_at: "2026-10-20T20:00:00Z", shared_at: "2026-10-21T20:00:00Z" },
  ] }),
  previewInvestmentReport: async (r: any) => { calls.previews.push(r); return { ok: true, name: "n.pdf", base64: btoa("%PDF-1.4") }; },
  fileInvestmentReport: async (r: any) => { calls.files.push(r); return { ok: true, url: "u", name: "n.pdf" }; },
  shareInvestmentReport: async (...a: unknown[]) => { calls.shares.push(a); return { ok: true, notified: 1 }; },
  unshareInvestmentReport: async (...a: unknown[]) => { calls.unshares.push(a); return { ok: true }; },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { InvestmentReport } from "../modules/investments/InvestmentReport";

describe("the client report page", () => {
  it("shows each person's readiness and builds a preview from the chosen people, funds option and note", async () => {
    (globalThis as any).URL.createObjectURL = vi.fn(() => "blob:x"); (globalThis as any).URL.revokeObjectURL = vi.fn();
    render(<InvestmentReport householdId="h" />);
    await waitFor(() => expect(screen.getByTestId("investment-report")).toBeTruthy());
    expect(screen.getByText(/Risk profile: balanced. Recommendation: saved./)).toBeTruthy();
    expect(screen.getByText(/Risk profile: not recorded. Recommendation: none yet./)).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Include Lisa Santos"));
    fireEvent.click(screen.getByLabelText("List the portfolio's funds"));
    fireEvent.click(screen.getByText("Preview the PDF"));
    await waitFor(() => expect(calls.previews.length).toBe(1));
    expect(calls.previews[0]).toMatchObject({ householdId: "h", contactIds: ["a"], includeFunds: false });
    await waitFor(() => expect(screen.getByTestId("report-preview")).toBeTruthy());
  });
  it("shares a filed report after confirming, and hides a shared one", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<InvestmentReport householdId="h" />);
    await waitFor(() => expect(screen.getByTestId("filed-reports")).toBeTruthy());
    fireEvent.click(screen.getByText("Share in the portal"));
    await waitFor(() => expect(calls.shares.length).toBe(1));
    expect(calls.shares[0]).toEqual(["x1", true, "h"]);
    fireEvent.click(screen.getByText("Hide from the portal"));
    await waitFor(() => expect(calls.unshares.length).toBe(1));
    expect(calls.unshares[0]).toEqual(["x2", "h"]);
  });
});
