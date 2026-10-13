import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const invoke = vi.fn();
vi.mock("@/shared/integrations/supabase/client", () => ({ supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { PortalRebalancing } from "@/modules/portal/components/PortalRebalancing";

const state = { label: "Q3 2027", windowEnd: "2027-09-30", acknowledgedAt: null, statement: "I authorize ProsperWise Advisors to rebalance my portfolio back to its target allocation.", statementVersion: "v1" };

describe("PortalRebalancing", () => {
  beforeEach(() => invoke.mockReset());

  it("asks the client to review and acknowledge, showing the quarter and the deadline", () => {
    render(<PortalRebalancing rebalancing={state} portalToken="t" onChanged={vi.fn()} onTalkFirst={vi.fn()} />);
    expect(screen.getByText(/Portfolio rebalancing · Q3 2027/)).toBeTruthy();
    expect(screen.getByText(/acknowledge it by September 30, 2027/)).toBeTruthy();
  });

  it("shows the exact wording before recording an acknowledgement", async () => {
    invoke.mockResolvedValue({ data: { ok: true }, error: null });
    const onChanged = vi.fn();
    render(<PortalRebalancing rebalancing={state} portalToken="tok" onChanged={onChanged} onTalkFirst={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Review and acknowledge" }));
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

  it("does not open booking or refresh when the server refuses", async () => {
    invoke.mockResolvedValue({ data: { error: "There is no rebalancing waiting for you right now." }, error: null });
    const onTalkFirst = vi.fn();
    render(<PortalRebalancing rebalancing={state} portalToken="tok" onChanged={vi.fn()} onTalkFirst={onTalkFirst} />);
    fireEvent.click(screen.getByRole("button", { name: "I'd like to talk first" }));
    await waitFor(() => expect(invoke).toHaveBeenCalled());
    expect(onTalkFirst).not.toHaveBeenCalled();
  });

  it("shows a thank-you with the date once acknowledged, with no buttons", () => {
    render(<PortalRebalancing rebalancing={{ ...state, acknowledgedAt: "2027-08-05T18:00:00Z" }} portalToken="t" onChanged={vi.fn()} onTalkFirst={vi.fn()} />);
    expect(screen.getByText(/Acknowledged on August 5, 2027/)).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
