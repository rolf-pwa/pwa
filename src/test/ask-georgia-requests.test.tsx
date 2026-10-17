import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/shared/components/AppLayout", () => ({ AppLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/modules/crm/lib/reviewAgent", () => ({
  getSupportOverview: () => Promise.resolve({
    away: { away_from: null, away_until: null, note: null },
    conversations: [{ id: "c1", contact_id: "k1", contact_name: "Ed Weiss", messages: [], advisor_active: false, flag: null, flag_summary: null, flagged_at: null, away_when_flagged: false, reviewed_at: null, updated_at: "2026-10-19T17:00:00Z" }],
  }),
  reviewSupportConversation: vi.fn(), handBackSupportConversation: vi.fn(), setAway: vi.fn(), replyToSupportConversation: vi.fn(),
}));
const req = (id: string, contact_id: string, name: string, status: string) => ({
  id, contact_id, request_type: "banking_withdrawal", request_description: `Request ${id}`, status, file_urls: null, staff_notes: null,
  request_details: null, created_at: "2026-10-18T12:00:00Z", updated_at: "2026-10-18T12:00:00Z", resolved_at: null, contact: { full_name: name }, messages: [],
});
vi.mock("@/shared/integrations/supabase/client", () => ({
  supabase: { from: () => ({ select: () => ({ order: () => Promise.resolve({ data: [req("r1", "k1", "Ed Weiss", "submitted"), req("r2", "k2", "Ann Lee", "in_progress")], error: null }) }) }) },
}));
import AskGeorgia from "@/modules/crm/pages/AskGeorgia";

describe("Ask Georgia inbox requests", () => {
  it("shows a client's requests inside their thread", async () => {
    render(<MemoryRouter><AskGeorgia /></MemoryRouter>);
    expect(await screen.findByText("1 open request")).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: "Ed Weiss" }));
    expect(await screen.findByText("Request r1")).toBeTruthy();
  });
  it("keeps requests from clients with no chat", async () => {
    render(<MemoryRouter><AskGeorgia /></MemoryRouter>);
    expect(await screen.findByText("Request r2")).toBeTruthy();
    expect(screen.getByText("Ann Lee")).toBeTruthy();
  });
});
