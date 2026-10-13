import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/shared/components/AppLayout", () => ({ AppLayout: ({ children }: any) => <div>{children}</div> }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock("@/modules/crm/lib/reviewAgent", async () => {
  const ob = (id: string, family: string, kind: string, start: string, end: string, status: string, extra: any = {}) => ({
    id, family_id: `f-${id}`, family_name: family, kind, window_key: id, window_start: start, window_end: end, tier: "tier_3", mode: "shadow", status, booked_start: null, nudge_count: 0, escalation_reason: null, invite: true, ...extra,
  });
  const actual = await vi.importActual<any>("@/modules/crm/lib/reviewAgent");
  return {
    ...actual,
    getReviewOverview: vi.fn().mockResolvedValue({
      config: { mode: "shadow", since: "2026-10-12T00:00:00Z", remind_every_days: 21, handoff_days_before_end: 21, max_nudges: 4, send_start_hour: 9, send_end_hour: 17, weekdays_only: true },
      obligations: [
        ob("a", "Jerczynski", "governance_review", "2026-10-01", "2026-12-31", "booked", { booked_start: "2026-10-13T21:00:00Z", invite: false }),
        ob("b", "Lively-Lambert", "governance_review", "2026-10-01", "2026-12-31", "open", { invite: false }),
        ob("c", "Smith", "annual_review", "2027-01-01", "2027-03-31", "open"),
        ob("d", "Jones", "annual_review", "2027-01-01", "2027-03-31", "escalated"),
        ob("e", "Fox", "sovereignty_review", "2027-04-01", "2027-06-30", "open"),
      ],
      events: [],
    }),
    getReminderOverview: vi.fn().mockResolvedValue({ config: { mode: "shadow", send_start_hour: 8, send_end_hour: 20, last_unmatched: [] }, recent: [] }),
    setReviewMode: vi.fn(), setReviewPaused: vi.fn(), setReminderMode: vi.fn(),
  };
});

import ReviewAgent from "@/modules/crm/pages/ReviewAgent";

describe("Georgia's review windows page", () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-05T18:00:00Z")); });
  afterEach(() => { vi.useRealTimers(); });

  it("groups meetings by quarter, marks the current one and counts each status", async () => {
    render(<MemoryRouter><ReviewAgent /></MemoryRouter>);
    const q4 = await screen.findByRole("region", { name: "Q4 2026" });
    expect(within(q4).getByText("Now")).toBeTruthy();
    expect(within(q4).getByText("2 meetings")).toBeTruthy();
    expect(within(q4).getByText("1 not booked")).toBeTruthy();
    expect(within(q4).getByText("1 booked")).toBeTruthy();
    const q1 = screen.getByRole("region", { name: "Q1 2027" });
    expect(within(q1).getByText("1 with a person")).toBeTruthy();
    expect(screen.getByRole("region", { name: "Q2 2027" })).toBeTruthy();
    // The family needing a person is listed first within its quarter.
    const names = within(q1).getAllByRole("link").map((l) => l.textContent);
    expect(names).toEqual(["Jones Family", "Smith Family"]);
  });

  it("filters to what needs a person and hides quarters with nothing to show", async () => {
    render(<MemoryRouter><ReviewAgent /></MemoryRouter>);
    await screen.findByRole("region", { name: "Q4 2026" });
    fireEvent.click(screen.getByRole("radio", { name: "Needs a person" }));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Q4 2026" })).toBeNull());
    expect(screen.getByRole("region", { name: "Q1 2027" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Q2 2027" })).toBeNull();
  });

  it("collapses and expands a quarter", async () => {
    render(<MemoryRouter><ReviewAgent /></MemoryRouter>);
    const q2 = await screen.findByRole("region", { name: "Q2 2027" });
    expect(within(q2).getByText("Fox Family")).toBeTruthy();
    fireEvent.click(within(q2).getByRole("button", { expanded: true }));
    expect(within(q2).queryByText("Fox Family")).toBeNull();
  });
});
