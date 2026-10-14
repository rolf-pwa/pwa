import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const invoke = vi.fn();
vi.mock("@/shared/integrations/supabase/client", () => ({ supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { PortalRebalancing } from "@/modules/portal/components/PortalRebalancing";

const state = {
  label: "Q3 2027", summary: "We are moving your TFSA back to the 60/40 target and topping up your cash reserve.", publishedAt: "2027-08-02T18:00:00Z",
  acknowledgedAt: null, completedAt: null, statement: "I have reviewed the proposed rebalancing of my portfolio shown here. I authorize ProsperWise Advisors to carry it out.", statementVersion: "v2",
};

describe("PortalRebalancing", () => {
  beforeEach(() => invoke.mockReset());

  it("shows what Rolf proposed before offering any consent", () => {
    render(<PortalRebalancing rebalancing={state} portalToken="t" onChanged={vi.fn()} onTalkFirst={vi.fn()} />);
    expect(screen.getByText(/Portfolio rebalancing · Q3 2027/)).toBeTruthy();
    expect(screen.getByText(state.summary)).toBeTruthy();
    expect(screen.getByText(/proposal is in your Documents/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "I've reviewed it: acknowledge" })).toBeTruthy();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("shows the consent wording and records nothing until the client confirms it", async () => {
    invoke.mockResolvedValue({ data: { ok: true }, error: null });
    const onChanged = vi.fn();
    render(<PortalRebalancing rebalancing={state} portalToken="tok" onChanged={onChanged} onTalkFirst={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "I've reviewed it: acknowledge" }));
    expect(await screen.findByText(state.statement)).toBeTruthy();
    expect(invoke).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "I acknowledge and approve" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("portal-rebalance", { body: { portal_token: "tok", action: "acknowledge" } }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it("lets the client talk first, which opens booking", async () => {
    invoke.mockResolvedValue({ data: { ok: true }, error: null });
    const onTalkFirst = vi.fn();
    render(<PortalRebalancing rebalancing={state} portalToken="tok" onChanged={vi.fn()} onTalkFirst={onTalkFirst} />);
    fireEvent.click(screen.getByRole("button", { name: "I'd like to talk first" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("portal-rebalance", { body: { portal_token: "tok", action: "talk_first" } }));
    await waitFor(() => expect(onTalkFirst).toHaveBeenCalled());
  });

  it("does not open booking when the server refuses", async () => {
    invoke.mockResolvedValue({ data: { error: "There is no rebalancing waiting for you right now." }, error: null });
    const onTalkFirst = vi.fn();
    render(<PortalRebalancing rebalancing={state} portalToken="tok" onChanged={vi.fn()} onTalkFirst={onTalkFirst} />);
    fireEvent.click(screen.getByRole("button", { name: "I'd like to talk first" }));
    await waitFor(() => expect(invoke).toHaveBeenCalled());
    expect(onTalkFirst).not.toHaveBeenCalled();
  });

  it("says Rolf is carrying it out once acknowledged, then that it is complete, with no buttons", () => {
    const { rerender } = render(<PortalRebalancing rebalancing={{ ...state, acknowledgedAt: "2027-08-05T18:00:00Z" }} portalToken="t" onChanged={vi.fn()} onTalkFirst={vi.fn()} />);
    expect(screen.getByText(/Acknowledged on August 5, 2027/)).toBeTruthy();
    expect(screen.getByText(/Rolf is carrying it out/)).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
    rerender(<PortalRebalancing rebalancing={{ ...state, acknowledgedAt: "2027-08-05T18:00:00Z", completedAt: "2027-08-09T18:00:00Z" }} portalToken="t" onChanged={vi.fn()} onTalkFirst={vi.fn()} />);
    expect(screen.getByText(/Completed on August 9, 2027/)).toBeTruthy();
  });
});
