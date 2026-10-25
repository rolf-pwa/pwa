import { describe, it, expect, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/shared/components/AppLayout", () => ({ AppLayout: ({ children }: any) => <div>{children}</div> }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("@/shared/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));
const supabaseMock: Record<string, unknown> = {};
const briefing = {
  generation_status: "complete", generation_error: null, greeting: "Good morning", summary_line: "A full day with one conflict.", generated_at: "2026-10-19T12:35:00Z",
  priority_items: [{ label: "Reply to Jane about her RRSP", link: "https://mail.google.com/mail/u/0/#all/1", reason: "asked yesterday", next_step: "Send the transfer form" }, { label: "Monthly file 2026-10-30 is held", link: "/importers", reason: "waiting on you", next_step: "" }],
  sections: {
    schedule: [{ start: "2026-10-19T17:00:00Z", end: "2026-10-19T18:00:00Z", allDay: false, summary: "Client A", link: null, conflict: true }],
    week: [{ date: "2026-10-23", items: [{ start: "2026-10-23T22:00:00Z", allDay: false, summary: "Board Meeting", link: null }] }],
    replies: [{ from: "Jane <jane@x.ca>", subject: "RRSP question", link: "https://mail/1" }], ia: [{ kind: "ia_notice", from: "iA", subject: "Business Tracker update", link: "https://mail/2" }],
    texts: [{ label: "Can you call me?", contact: "Sam Smith", link: "/inbox" }], firm: [{ label: "Glanz: rebalancing handed to you", link: "/review-agent" }], counts: { spam: 3, promo: 2, automated: 4, adminTotal: 6 },
  },
};
vi.mock("@/shared/integrations/supabase/client", () => ({ supabase: { from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: (supabaseMock as any).current ?? briefing }) }) }) }) }), functions: { invoke: vi.fn() }, channel: () => { const c: any = { on: () => c, subscribe: () => c }; return c; }, removeChannel: vi.fn() } }));

import Briefing from "@/modules/crm/pages/Briefing";
import { supabase } from "@/shared/integrations/supabase/client";

describe("the morning briefing page", () => {
  it("shows the ranked priorities with a suggested next step, and each section behind them", async () => {
    render(<MemoryRouter><Briefing /></MemoryRouter>);
    expect(await screen.findByText("Good morning")).toBeTruthy();
    expect(screen.getByText("Reply to Jane about her RRSP").closest("a")?.getAttribute("href")).toContain("mail.google.com");
    expect(screen.getByText(/Suggested: Send the transfer form/)).toBeTruthy();
    expect(screen.getByText("Monthly file 2026-10-30 is held").closest("a")?.getAttribute("href")).toBe("/importers");
    // the calendar is behind its button, not a block on the page
    expect(screen.queryByText("Board Meeting")).toBeNull();
  });
  it("shows tabs across the top, the Briefing first, and each list in its tab", async () => {
    render(<MemoryRouter><Briefing /></MemoryRouter>);
    expect(await screen.findByTestId("today-tiles")).toBeTruthy();
    expect(screen.getByTestId("tile-briefing").getAttribute("data-state")).toBe("active");
    for (const [id, n] of [["messages", "3"], ["requests", "0"], ["firm", "1"], ["calendar", "1"], ["tasks", "0"]]) expect(screen.getByTestId(`count-${id}`).textContent, id).toBe(n);
    // the lists are not on the Briefing: they are in their tabs
    expect(screen.queryByText("RRSP question")).toBeNull();
    const pick = (id: string) => act(() => { fireEvent.mouseDown(screen.getByTestId(`tile-${id}`), { button: 0 }); });
    pick("messages");
    const panel = await screen.findByTestId("today-panel");
    for (const t of ["RRSP question", "Business Tracker update", "Sam Smith"]) expect(within(panel).getByText(t)).toBeTruthy();
    pick("calendar");
    const cal = await screen.findByTestId("today-panel");
    expect(within(cal).getByText("Client A")).toBeTruthy();
    expect(within(cal).getByText("Overlaps")).toBeTruthy();
    expect(within(cal).getByText("Board Meeting")).toBeTruthy();
  });
  it("has Regenerate as a quiet text link inside the Briefing card, not a button in the page header", async () => {
    render(<MemoryRouter><Briefing /></MemoryRouter>);
    const link = await screen.findByTestId("regenerate");
    expect(link.textContent).toBe("Regenerate");
    expect(link.tagName).toBe("BUTTON");
    expect(link.className).not.toMatch(/border|bg-primary/); // a link, not a button
    expect(link.closest("[class*='border-accent']")).toBeTruthy(); // inside the Briefing card
    expect(link.closest("h1")).toBeNull();
    expect(screen.getAllByTestId("regenerate")).toHaveLength(1);
    fireEvent.click(link);
    expect((supabase.functions.invoke as any).mock.calls.some(([fn, opts]: any[]) => fn === "daily-briefing-generate" && JSON.stringify(opts?.body) === "{}")).toBe(true);
  });
  it("says what was left out, and that nothing was changed", async () => {
    render(<MemoryRouter><Briefing /></MemoryRouter>);
    expect(await screen.findByText(/3 likely spam, 2 newsletters and promotions, 4 automated notices/)).toBeTruthy();
    expect(screen.getByText(/Nothing was deleted/)).toBeTruthy();
    expect(screen.getByText(/only reads/)).toBeTruthy();
  });

  it("shows how much has been handled, and what", async () => {
    const withHandled = { ...briefing, sections: { ...briefing.sections, handled: [{ label: "IA Financial - Guaranteed Insurability Option", link: null }] } };
    (supabaseMock as any).current = withHandled;
    render(<MemoryRouter><Briefing /></MemoryRouter>);
    expect(await screen.findByTestId("progress")).toBeTruthy();
    expect(screen.getByTestId("progress").textContent).toMatch(/2 still open · 1 handled since this morning/);
    expect(screen.getByText(/Handled since this morning \(1\)/)).toBeTruthy();
    (supabaseMock as any).current = briefing;
  });
});
