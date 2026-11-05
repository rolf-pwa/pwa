// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const updates: { table: string; payload: Record<string, unknown>; where: unknown }[] = [];
const state = { master: false };
const action = (id: string, category: string, verdict: string | null) => ({
  id, created_at: "2026-11-05T20:00:00Z", category, summary: `Shadow: ${category} would be answered`, request_id: `r-${id}`,
  detail: { wouldBe: "answered", verdict, decision: { reason: `${category} is in shadow: recorded, still Rolf's` } },
  portal_requests: { request_description: "Can I book a meeting with Rolf next week", request_type: "general_inquiry" },
});
const actions = [action("a1", "meetings", null), action("a2", "meetings", "right")];

vi.mock("@/shared/components/AppLayout", () => ({ AppLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("@/shared/hooks/useAuth", () => ({ useAuth: () => ({ user: { email: "rolf@prosperwise.ca" } }) }));
vi.mock("@/shared/integrations/supabase/client", () => ({
  supabase: {
    from(table: string) {
      let pending: Record<string, unknown> | null = null;
      const q: Record<string, unknown> = {
        select: () => q, order: () => q, limit: () => q,
        eq: (_c: string, v: unknown) => { if (pending) { updates.push({ table, payload: pending, where: v }); pending = null; return Promise.resolve({ error: null }); } return q; },
        update: (payload: Record<string, unknown>) => { pending = payload; return q; },
        maybeSingle: async () => ({ data: table === "georgia_autonomy_master" ? { enabled: state.master } : null }),
        then: (res: (v: unknown) => unknown) => res({ error: null, data: table === "georgia_autonomy_config" ? [{ category: "meetings", mode: "shadow" }] : table === "georgia_actions" ? actions : [] }),
      };
      return q;
    },
  },
}));
import GeorgiaAutonomy from "@/modules/crm/pages/GeorgiaAutonomy";

const show = () => render(<MemoryRouter><GeorgiaAutonomy /></MemoryRouter>);
beforeEach(() => { document.body.innerHTML = ""; updates.length = 0; state.master = false; });

describe("the Georgia autonomy page", () => {
  it("shows the switch off, the shadow review and what she would have done", async () => {
    show();
    await waitFor(() => expect(screen.getAllByTestId("shadow-row")).toHaveLength(2));
    expect(screen.getByTestId("master-switch").getAttribute("aria-checked")).toBe("false");
    expect(screen.getAllByText(/Can I book a meeting with Rolf next week/)).toHaveLength(2);
    const tallyRow = screen.getByTestId("tally-meetings");
    expect(within(tallyRow).getByText("2")).toBeTruthy();
    expect(within(tallyRow).getByText(/Meeting logistics/)).toBeTruthy();
  });
  it("turns the master switch on and records who did it", async () => {
    show();
    await waitFor(() => expect(screen.getByTestId("master-switch")).toBeTruthy());
    fireEvent.click(screen.getByTestId("master-switch"));
    await waitFor(() => expect(updates.find((u) => u.table === "georgia_autonomy_master")).toBeTruthy());
    expect(updates.find((u) => u.table === "georgia_autonomy_master")!.payload).toMatchObject({ enabled: true, updated_by: "rolf@prosperwise.ca" });
  });
  it("saves a Right verdict on a request, and a second click on the same one clears it", async () => {
    show();
    await waitFor(() => expect(screen.getAllByTestId("shadow-row")).toHaveLength(2));
    const first = screen.getAllByTestId("shadow-row")[0];
    fireEvent.click(within(first).getByTestId("verdict-right"));
    await waitFor(() => expect(updates.filter((u) => u.table === "georgia_actions")).toHaveLength(1));
    expect(updates[0].payload).toMatchObject({ detail: { verdict: "right", verdict_by: "rolf@prosperwise.ca" } });
    expect(updates[0].where).toBe("a1");
    fireEvent.click(within(first).getByTestId("verdict-right"));
    await waitFor(() => expect(updates.filter((u) => u.table === "georgia_actions")).toHaveLength(2));
    expect(updates[1].payload).toMatchObject({ detail: { verdict: null } });
  });
});
