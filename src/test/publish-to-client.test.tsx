import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("@/modules/crm/lib/reviewAgent", () => ({ publishPortfolioReview: vi.fn(), unpublishPortfolioReview: vi.fn() }));
vi.mock("@/modules/portal/components/PortalPortfolioReview", () => ({ PortalPortfolioReview: () => <div>preview</div> }));
import { PublishToClient } from "@/modules/crm/components/PublishToClient";

const pack: any = { asOf: "2026-09-30", totalValue: 0, accounts: [], household: { classTotals: { income: 0, canadian_equity: 0, us_intl_equity: 0, equity_other: 0, other: 0 }, drift: { status: "no_data" }, modelComparison: null, valueWeightedYtd: null, changeYtd: null, changeSincePrior: null }, resets: { rows: [], toReset: 0, totalRoom: 0 }, rebalancing: { rows: [], toIncome: 0, toEquity: 0, needed: 0, taxable: 0, resets: 0, resetLift: 0 }, history: [], exceptions: [], gaps: [] };
const ob = { id: "o1", window_start: "2026-07-01", window_end: "2026-09-30", status: "open", published_at: null, acknowledged_at: null, completed_at: null };

describe("PublishToClient for a rebalance", () => {
  it("offers the rebalancing only when the household has one due", () => {
    render(<PublishToClient householdId="h" householdLabel="H" pack={pack} publication={null} onChanged={() => {}} />);
    expect(screen.queryByTestId("rebalance-publish")).toBeNull();
  });
  it("greys out everything but the funds, the death benefit reset and the proposal", () => {
    render(<PublishToClient householdId="h" householdLabel="H" pack={pack} publication={null} rebalancingObligation={ob} onChanged={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /Publish the rebalancing/ }));
    const box = (name: RegExp) => screen.getByRole("checkbox", { name }) as HTMLButtonElement;
    expect(box(/Values and returns by account/).hasAttribute("disabled")).toBe(true);
    expect(box(/Mix against their Investor Profile/).hasAttribute("disabled")).toBe(true);
    expect(box(/Funds against our model portfolio/).hasAttribute("disabled")).toBe(false);
    expect(box(/What I propose to switch/).hasAttribute("disabled")).toBe(false);
    expect(box(/Death benefit reset/).hasAttribute("disabled")).toBe(false);
    expect(screen.getByRole("button", { name: "Publish" }).hasAttribute("disabled")).toBe(true);
  });
  it("shows that the client has authorized it", () => {
    render(<PublishToClient householdId="h" householdLabel="H" pack={pack} publication={null} rebalancingObligation={{ ...ob, acknowledged_at: "2026-10-21T16:00:00Z" }} onChanged={() => {}} />);
    expect(screen.getByText(/The client authorized it on/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Publish the rebalancing/ })).toBeNull();
  });
});
