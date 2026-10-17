import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/shared/components/AppLayout", () => ({ AppLayout: ({ children }: any) => <div>{children}</div> }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("@/shared/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));
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
vi.mock("@/shared/integrations/supabase/client", () => ({ supabase: { from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: briefing }) }) }) }) }), functions: { invoke: vi.fn() } } }));

import Briefing from "@/modules/crm/pages/Briefing";

describe("the morning briefing page", () => {
  it("shows the ranked priorities with a suggested next step, and each section behind them", async () => {
    render(<MemoryRouter><Briefing /></MemoryRouter>);
    expect(await screen.findByText("Good morning")).toBeTruthy();
    expect(screen.getByText("Reply to Jane about her RRSP").closest("a")?.getAttribute("href")).toContain("mail.google.com");
    expect(screen.getByText(/Suggested: Send the transfer form/)).toBeTruthy();
    expect(screen.getByText("Monthly file 2026-10-30 is held").closest("a")?.getAttribute("href")).toBe("/importers");
    expect(screen.getByText("Overlaps")).toBeTruthy();
    expect(screen.getByText("Board Meeting")).toBeTruthy();
    expect(screen.getByText("RRSP question")).toBeTruthy();
    expect(screen.getByText("Business Tracker update")).toBeTruthy();
    expect(screen.getByText("Sam Smith")).toBeTruthy();
    expect(screen.getByText("Glanz: rebalancing handed to you")).toBeTruthy();
  });
  it("says what was left out, and that nothing was changed", async () => {
    render(<MemoryRouter><Briefing /></MemoryRouter>);
    expect(await screen.findByText(/3 likely spam, 2 newsletters and promotions, 4 automated notices/)).toBeTruthy();
    expect(screen.getByText(/Nothing was deleted/)).toBeTruthy();
    expect(screen.getByText(/only reads/)).toBeTruthy();
  });
});
