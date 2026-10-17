import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const reply = vi.fn(() => Promise.resolve({ ok: true, messages: [] }));
vi.mock("@/shared/components/AppLayout", () => ({ AppLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/modules/crm/lib/reviewAgent", () => ({
  getSupportOverview: () => Promise.resolve({
    away: { away_from: null, away_until: null, note: null },
    conversations: [{ id: "c1", contact_id: "k1", contact_name: "Ed Weiss", messages: [{ role: "user", content: "Where is my withdrawal?" }], advisor_active: false, flag: "routine", flag_summary: "Asks about a withdrawal", flagged_at: null, away_when_flagged: false, reviewed_at: null, updated_at: "2026-10-19T17:00:00Z" }],
  }),
  reviewSupportConversation: vi.fn(), handBackSupportConversation: vi.fn(), setAway: vi.fn(),
  replyToSupportConversation: (...a: unknown[]) => reply(...(a as [])),
}));
import AskGeorgia from "@/modules/crm/pages/AskGeorgia";

describe("Ask Georgia page reply box", () => {
  beforeEach(() => reply.mockClear());
  async function openBox() {
    render(<MemoryRouter><AskGeorgia /></MemoryRouter>);
    fireEvent.click(await screen.findByRole("button", { name: "Ed Weiss" }));
    return screen.findByPlaceholderText(/Reply to the client/);
  }
  it("sends on Return", async () => {
    const box = await openBox();
    fireEvent.change(box, { target: { value: "It went out this morning." } });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(reply).toHaveBeenCalledWith("c1", "It went out this morning."));
  });
  it("adds a line on Shift+Return instead of sending", async () => {
    const box = await openBox();
    fireEvent.change(box, { target: { value: "One" } });
    fireEvent.keyDown(box, { key: "Enter", shiftKey: true });
    expect(reply).not.toHaveBeenCalled();
  });
  it("does not send an empty reply", async () => {
    const box = await openBox();
    fireEvent.keyDown(box, { key: "Enter" });
    expect(reply).not.toHaveBeenCalled();
  });
});
