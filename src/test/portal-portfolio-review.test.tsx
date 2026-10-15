import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { vi } from "vitest";
import { PortalPortfolioReview } from "@/modules/portal/components/PortalPortfolioReview";
import type { ClientView } from "../../supabase/functions/_shared/portfolio-review-client";

const view = (over: Partial<ClientView> = {}): ClientView => ({
  householdLabel: "Parent Household", valuesAsOf: "2026-09-30", note: "Good year overall.", summary: { value: 532_937, changeYtd: -9_616, ytdPct: 5 },
  accounts: [{ label: "RRIF …0719", name: "iA RRSP", owner: "Doreen Parent", last4: "0719", value: 66_931, changeYtd: 1, ytdPct: 4.7, oneYearPct: 6.8, threeYearPct: 11 }],
  history: [{ date: "2026-06-30", value: 520_000 }, { date: "2026-09-30", value: 532_937 }],
  mix: { commentary: ["Your household asset mix falls within your Balanced risk profile, which holds 35–55% in income funds. Your income allocation is toward the lower end of that range.", "I recommend rebalancing these accounts back to your Balanced profile. I will take you through the details at our meeting."], classes: [{ key: "income", label: "Income", pct: 35.7 }, { key: "canadian", label: "Canadian equity", pct: 28.8 }, { key: "global", label: "U.S. and international equity", pct: 35.5 }], profileLabel: "Balanced", incomePct: 35.7, equityPct: 64.3, rangeMin: 35, rangeMax: 55, targetIncomePct: 40, status: "inside", accounts: [{ name: "iA TFSA", last4: "3190", incomePct: 33.6, status: "below" }] },
  funds: { commentary: ["27% of your portfolio is held in funds outside our Balanced model portfolio, including Thematic Innovation (iA).", "I recommend rebalancing the portfolio to the model."], modelLabel: "Balanced", modelAsOf: "2026-05-31", heldInModelPct: 73, rows: [{ name: "Fidelity Insights", modelPct: 20, heldPct: 8.2, inModel: true }, { name: "Thematic Innovation (iA)", modelPct: null, heldPct: 6.9, inModel: false }] },
  proposal: { switches: [{ id: "switch:a1", label: "TFSA …3190", owner: "Albert Parent", direction: "to_income", amount: 6_000, taxable: false }, { id: "switch:a2", label: "Non-registered …6067", owner: "Albert Parent", direction: "to_income", amount: 5_000, taxable: true }], resets: [{ id: "reset:a1", label: "TFSA …3190", owner: "Albert Parent", currentGuarantee: 136_018, newGuarantee: 146_200, lift: 10_183 }], totalLift: 10_183, totalNow: 136_018, totalAfter: 146_200, hasTaxable: true },
  disclosures: ["Past performance does not guarantee future results."], ...over,
});

describe("PortalPortfolioReview", () => {
  it("shows Rolf's note, the figures and each section in plain words", () => {
    render(<PortalPortfolioReview view={view()} publishedAt="2026-10-20T16:00:00Z" />);
    expect(screen.getByText("Your Portfolio Review")).toBeTruthy();
    expect(screen.getByText("Good year overall.")).toBeTruthy();
    expect(screen.getByText("Inside your range")).toBeTruthy();
    expect(screen.getByText(/toward the lower end of that range/)).toBeTruthy();
    expect(screen.getByText(/I recommend rebalancing the portfolio to the model/)).toBeTruthy();
    expect(screen.getByText(/Compared with your Balanced profile/)).toBeTruthy();
    expect(screen.getByText(/73% of what you hold is in the funds our model portfolio uses/)).toBeTruthy();
    expect(screen.getAllByText(/not part of the model/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("$146,200").length).toBeGreaterThan(0);
    expect(screen.getByText(/up \$10,183 from \$136,018 today/)).toBeTruthy();
    expect(screen.getByText("What I propose")).toBeTruthy();
    expect(screen.getByText(/Past performance does not guarantee/)).toBeTruthy();
    expect(screen.queryByText(/Not in model/i)).toBeNull();
  });
  it("says when the mix is off the profile, in plain words", () => {
    render(<PortalPortfolioReview view={view({ mix: { ...view().mix!, status: "below" } })} />);
    expect(screen.getByText("More growth-oriented than your profile")).toBeTruthy();
  });
  it("leaves out sections that were not included", () => {
    render(<PortalPortfolioReview view={view({ accounts: null, mix: null, funds: null, proposal: null, note: "" })} />);
    expect(screen.queryByText("Your accounts")).toBeNull();
    expect(screen.queryByText("Your mix")).toBeNull();
    expect(screen.queryByText(/Your death/)).toBeNull();
  });
  it("puts your accounts above your mix", () => {
    render(<PortalPortfolioReview view={view()} />);
    const accounts = screen.getByText("Your accounts"), mix = screen.getByText("Your mix");
    expect(accounts.compareDocumentPosition(mix) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
  it("labels a staff preview", () => {
    render(<PortalPortfolioReview view={view()} preview />);
    expect(screen.getByText("Preview: Your Portfolio Review")).toBeTruthy();
  });
});

describe("the proposal: tick, authorize, or talk it through", () => {
  it("is last in the review, with the switches and the resets each carrying a tick", () => {
    render(<PortalPortfolioReview view={view()} onAuthorize={async () => {}} onTalk={async () => {}} />);
    const proposal = screen.getByTestId("proposal");
    expect(proposal.textContent).toContain("Switches inside your accounts");
    expect(proposal.textContent).toContain("Death benefit guarantee resets");
    expect(screen.getAllByRole("checkbox").length).toBe(3);
    expect(screen.getByRole("button", { name: /^Authorize$/ }).hasAttribute("disabled")).toBe(true);
    const sections = screen.getAllByRole("heading", { level: 4 }).map((h) => h.textContent);
    expect(sections[sections.length - 1]).toBe("What I propose");
  });
  it("authorizes exactly the items ticked", async () => {
    const onAuthorize = vi.fn().mockResolvedValue(undefined);
    render(<PortalPortfolioReview view={view()} onAuthorize={onAuthorize} onTalk={async () => {}} />);
    fireEvent.click(screen.getByLabelText("Acknowledge TFSA …3190"));
    fireEvent.click(screen.getByLabelText("Acknowledge reset TFSA …3190"));
    fireEvent.click(screen.getByRole("button", { name: /Authorize 2 changes/ }));
    await waitFor(() => expect(onAuthorize).toHaveBeenCalledWith(["switch:a1", "reset:a1"]));
  });
  it("ticks everything with Tick all, and talks it through", async () => {
    const onAuthorize = vi.fn().mockResolvedValue(undefined);
    const onTalk = vi.fn().mockResolvedValue(undefined);
    render(<PortalPortfolioReview view={view()} onAuthorize={onAuthorize} onTalk={onTalk} />);
    fireEvent.click(screen.getByText("Tick all"));
    fireEvent.click(screen.getByRole("button", { name: /Authorize 3 changes/ }));
    await waitFor(() => expect(onAuthorize).toHaveBeenCalledWith(["switch:a1", "switch:a2", "reset:a1"]));
    fireEvent.click(screen.getByRole("button", { name: "Talk it through" }));
    await waitFor(() => expect(onTalk).toHaveBeenCalled());
  });
  it("shows what is already authorized as done, and says so when everything is", () => {
    const { unmount } = render(<PortalPortfolioReview view={view()} response={{ authorizedIds: ["switch:a1"], authorizedAt: "2026-10-20T16:00:00Z", talkFirstAt: null }} onAuthorize={async () => {}} onTalk={async () => {}} />);
    expect(screen.queryByLabelText("Acknowledge TFSA …3190")).toBeNull();
    expect(screen.getAllByRole("checkbox").length).toBe(2);
    expect(screen.getByText(/1 of 3 authorized/)).toBeTruthy();
    unmount();
    render(<PortalPortfolioReview view={view()} response={{ authorizedIds: ["switch:a1", "switch:a2", "reset:a1"], authorizedAt: "2026-10-20T16:00:00Z", talkFirstAt: null }} onAuthorize={async () => {}} onTalk={async () => {}} />);
    expect(screen.getByText(/You have authorized everything/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Authorize/ })).toBeNull();
  });
  it("cannot be used in a staff preview", () => {
    render(<PortalPortfolioReview view={view()} preview />);
    expect(screen.getByRole("button", { name: "Talk it through" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getAllByRole("checkbox").every((c) => (c as HTMLInputElement).disabled)).toBe(true);
  });
});
