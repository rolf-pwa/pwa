import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const invoke = vi.fn();
vi.mock("@/shared/integrations/supabase/client", () => ({ supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { PortalProposal } from "@/modules/portal/components/PortalProposal";
import { PortalRebalancingPage, PortalRebalancingTeaser, type RebalancingState } from "@/modules/portal/components/PortalRebalancing";
import type { ClientProposal } from "../../supabase/functions/_shared/portfolio-review-client";

const proposal: ClientProposal = { switches: [{ id: "switch:a", label: "TFSA …3190", owner: "Albert Parent", direction: "to_income", amount: 9_400, taxable: false }, { id: "switch:c", label: "Non-registered …6067", owner: "Albert Parent", direction: "to_income", amount: 7_500, taxable: true }], resets: [{ id: "reset:a", label: "TFSA …3190", owner: "Albert Parent", currentGuarantee: 136_018, newGuarantee: 145_261, lift: 9_243 }], totalLift: 9_243, totalNow: 136_018, totalAfter: 145_261, hasTaxable: true };
const rebalancing = (over: Partial<RebalancingState> = {}): RebalancingState => ({ label: "Q3 2027", summary: "Bringing your accounts back to the Balanced mix.", publishedAt: "2026-10-20T16:00:00Z", acknowledgedAt: null, completedAt: null, statement: "I authorize ProsperWise Advisors to carry it out.", statementVersion: "v2", proposal, ...over });

describe("PortalProposal", () => {
  it("lets the client authorize only once every change is ticked", async () => {
    const onAuthorize = vi.fn().mockResolvedValue(undefined);
    render(<PortalProposal proposal={proposal} statement="I authorize." onAuthorize={onAuthorize} onTalk={async () => {}} />);
    const authorize = screen.getByRole("button", { name: "Authorize" });
    expect(authorize.hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByLabelText("Acknowledge TFSA …3190"));
    fireEvent.click(screen.getByLabelText("Acknowledge Non-registered …6067"));
    expect(authorize.hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByLabelText("Acknowledge reset TFSA …3190"));
    expect(authorize.hasAttribute("disabled")).toBe(false);
    fireEvent.click(authorize);
    await waitFor(() => expect(onAuthorize).toHaveBeenCalledWith(["switch:a", "switch:c", "reset:a"]));
  });
  it("ticks everything with Tick all, and offers Talk it through", async () => {
    const onTalk = vi.fn().mockResolvedValue(undefined);
    render(<PortalProposal proposal={proposal} statement="I authorize." onAuthorize={async () => {}} onTalk={onTalk} />);
    fireEvent.click(screen.getByText("Tick all"));
    expect(screen.getByRole("button", { name: "Authorize" }).hasAttribute("disabled")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Talk it through" }));
    await waitFor(() => expect(onTalk).toHaveBeenCalled());
  });
  it("shows the switches, the resets with the guarantee headline, the taxable caution and the wording", () => {
    render(<PortalProposal proposal={proposal} statement="I authorize ProsperWise to carry it out." />);
    expect(screen.getByText("Switches inside your accounts")).toBeTruthy();
    expect(screen.getByText("Death benefit guarantee resets")).toBeTruthy();
    expect(screen.getByText("$145,261", { selector: "p" })).toBeTruthy();
    expect(screen.getByText(/taxable account: a switch can create a gain/)).toBeTruthy();
    expect(screen.getByText("I authorize ProsperWise to carry it out.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Talk it through" }).hasAttribute("disabled")).toBe(true);
  });
});

describe("the Tier 1 rebalancing page and pointer", () => {
  beforeEach(() => { invoke.mockReset(); });
  it("points to the review from the dashboard until it is authorized", () => {
    const onOpen = vi.fn();
    const { unmount } = render(<PortalRebalancingTeaser rebalancing={rebalancing()} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole("button", { name: /Review and authorize/ }));
    expect(onOpen).toHaveBeenCalled();
    unmount();
    render(<PortalRebalancingTeaser rebalancing={rebalancing({ acknowledgedAt: "2026-10-21T00:00:00Z" })} onOpen={onOpen} />);
    expect(screen.queryByTestId("rebalancing-teaser")).toBeNull();
  });
  it("authorizes by sending every item id, as the acknowledgement", async () => {
    invoke.mockResolvedValue({ data: { ok: true }, error: null });
    render(<PortalRebalancingPage rebalancing={rebalancing()} portalToken="tok" onChanged={() => {}} onBack={() => {}} />);
    fireEvent.click(screen.getByText("Tick all"));
    fireEvent.click(screen.getByRole("button", { name: "Authorize" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("portal-rebalance", { body: { portal_token: "tok", action: "acknowledge", item_ids: ["switch:a", "switch:c", "reset:a"] } }));
  });
  it("records talk it through and opens the Interim Strategy Session scheduler", async () => {
    invoke.mockResolvedValue({ data: { ok: true }, error: null });
    render(<PortalRebalancingPage rebalancing={rebalancing()} portalToken="tok" onChanged={() => {}} onBack={() => {}} meetingTypes={[{ label: "Interim Strategy Session", url: "https://cal/i", embedUrl: "https://cal/embed" }]} />);
    fireEvent.click(screen.getByRole("button", { name: "Talk it through" }));
    await waitFor(() => expect(document.querySelector("iframe")?.getAttribute("src")).toBe("https://cal/embed"));
    expect(invoke).toHaveBeenCalledWith("portal-rebalance", { body: { portal_token: "tok", action: "talk_first", item_ids: undefined } });
  });
  it("shows Rolf's summary, and the result once it is authorized or done", () => {
    const { unmount } = render(<PortalRebalancingPage rebalancing={rebalancing({ acknowledgedAt: "2026-10-21T16:00:00Z" })} portalToken="tok" onChanged={() => {}} onBack={() => {}} />);
    expect(screen.getByText("Bringing your accounts back to the Balanced mix.")).toBeTruthy();
    expect(screen.getByText(/You authorized this on/)).toBeTruthy();
    expect(screen.queryByTestId("proposal")).toBeNull();
    unmount();
    render(<PortalRebalancingPage rebalancing={rebalancing({ completedAt: "2026-11-02T16:00:00Z" })} portalToken="tok" onChanged={() => {}} onBack={() => {}} />);
    expect(screen.getByText(/Completed on/)).toBeTruthy();
  });
});

import { PortalPortfolioReview } from "@/modules/portal/components/PortalPortfolioReview";
import type { ClientView } from "../../supabase/functions/_shared/portfolio-review-client";

describe("the rebalance page uses the review's format", () => {
  const view: ClientView = {
    kind: "rebalance", householdLabel: "Tier1 Household", valuesAsOf: "2026-09-30", note: "Moving back to the Balanced mix.", summary: { value: 189_270, changeYtd: 0, ytdPct: 5 }, history: [{ date: "2026-06-30", value: 1 }, { date: "2026-09-30", value: 2 }],
    accounts: null, mix: null,
    funds: { commentary: ["27% of your portfolio is held in funds outside our Balanced model portfolio."], modelLabel: "Balanced", modelAsOf: "2026-05-31", heldInModelPct: 73, rows: [{ name: "Fidelity Insights", modelPct: 20, heldPct: 8.2, inModel: true }] },
    reset: { rows: [{ name: "TFSA", owner: "Albert", last4: "3190", fundValue: 145_261, currentGuarantee: 136_018, newGuarantee: 145_261, lift: 9_243 }], totalLift: 9_243, totalNow: 136_018, totalAfter: 145_261 },
    proposal, disclosures: ["Past performance does not guarantee future results."],
  };
  it("shows the funds against the model, the death benefit reset and the proposal, and none of the values and returns", () => {
    render(<PortalPortfolioReview view={view} statement="I authorize." onAuthorize={async () => {}} onTalk={async () => {}} />);
    expect(screen.getByText("Your portfolio rebalancing")).toBeTruthy();
    expect(screen.getByText(/Your funds and our Balanced model portfolio/)).toBeTruthy();
    expect(screen.getAllByText(/Your death benefit guarantee/).length).toBeGreaterThan(0);
    expect(screen.getByTestId("proposal")).toBeTruthy();
    expect(screen.queryByText("Your accounts")).toBeNull();
    expect(screen.queryByText("Your mix")).toBeNull();
    expect(screen.queryByText("$189,270")).toBeNull();
    expect(screen.queryByText(/this year$/)).toBeNull();
  });
  it("leaves out the guarantee headline inside the proposal when the death benefit section is already above it", () => {
    render(<PortalPortfolioReview view={view} statement="I authorize." onAuthorize={async () => {}} onTalk={async () => {}} />);
    expect(screen.getByTestId("proposal").textContent).not.toContain("after this year's reset");
  });
  it("shows that it was authorized instead of the buttons", () => {
    render(<PortalPortfolioReview view={view} statement="I authorize." authorized={{ at: "2026-10-21T16:00:00Z" }} onAuthorize={async () => {}} onTalk={async () => {}} />);
    expect(screen.getByText(/You authorized this on/)).toBeTruthy();
    expect(screen.queryByTestId("proposal")).toBeNull();
  });
});
