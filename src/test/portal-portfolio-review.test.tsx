import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PortalPortfolioReview } from "@/modules/portal/components/PortalPortfolioReview";
import type { ClientView } from "../../supabase/functions/_shared/portfolio-review-client";

const view = (over: Partial<ClientView> = {}): ClientView => ({
  householdLabel: "Parent Household", valuesAsOf: "2026-09-30", note: "Good year overall.", summary: { value: 532_937, changeYtd: -9_616, ytdPct: 5 },
  accounts: [{ label: "RRIF …0719", name: "iA RRSP", owner: "Doreen Parent", last4: "0719", value: 66_931, changeYtd: 1, ytdPct: 4.7, oneYearPct: 6.8, threeYearPct: 11 }],
  history: [{ date: "2026-06-30", value: 520_000 }, { date: "2026-09-30", value: 532_937 }],
  mix: { commentary: ["Your household asset mix falls within your Balanced risk profile, which holds 35–55% in income funds. Your income allocation is toward the lower end of that range.", "We recommend rebalancing these accounts back to your Balanced profile. Rolf will take you through the details at your meeting."], classes: [{ key: "income", label: "Income", pct: 35.7 }, { key: "canadian", label: "Canadian equity", pct: 28.8 }, { key: "global", label: "U.S. and international equity", pct: 35.5 }], profileLabel: "Balanced", incomePct: 35.7, equityPct: 64.3, rangeMin: 35, rangeMax: 55, targetIncomePct: 40, status: "inside", accounts: [{ name: "iA TFSA", last4: "3190", incomePct: 33.6, status: "below" }] },
  funds: { commentary: ["27% of your portfolio is held in funds outside iA's Balanced model, including Thematic Innovation (iA).", "We recommend rebalancing the portfolio to the model."], modelLabel: "Balanced", modelAsOf: "2026-05-31", heldInModelPct: 73, rows: [{ name: "Fidelity Insights", modelPct: 20, heldPct: 8.2, inModel: true }, { name: "Thematic Innovation (iA)", modelPct: null, heldPct: 6.9, inModel: false }] },
  reset: { rows: [{ name: "iA TFSA", owner: "Albert", last4: "3190", fundValue: 146_200, currentGuarantee: 136_018, newGuarantee: 146_200, lift: 10_183 }], totalLift: 10_183 },
  disclosures: ["Past performance does not guarantee future results."], ...over,
});

describe("PortalPortfolioReview", () => {
  it("shows Rolf's note, the figures and each section in plain words", () => {
    render(<PortalPortfolioReview view={view()} publishedAt="2026-10-20T16:00:00Z" />);
    expect(screen.getByText("Your Portfolio Review")).toBeTruthy();
    expect(screen.getByText("Good year overall.")).toBeTruthy();
    expect(screen.getByText("Inside your range")).toBeTruthy();
    expect(screen.getByText(/toward the lower end of that range/)).toBeTruthy();
    expect(screen.getByText(/We recommend rebalancing the portfolio to the model/)).toBeTruthy();
    expect(screen.getByText(/Compared with your Balanced profile/)).toBeTruthy();
    expect(screen.getByText(/73% of what you hold is in the funds iA's model uses/)).toBeTruthy();
    expect(screen.getAllByText(/not part of the model/).length).toBeGreaterThan(0);
    expect(screen.getByText("+$10,183")).toBeTruthy();
    expect(screen.getByText(/Resetting your death benefit guarantee/)).toBeTruthy();
    expect(screen.getByText(/Past performance does not guarantee/)).toBeTruthy();
    expect(screen.queryByText(/Not in model/i)).toBeNull();
  });
  it("says when the mix is off the profile, in plain words", () => {
    render(<PortalPortfolioReview view={view({ mix: { ...view().mix!, status: "below" } })} />);
    expect(screen.getByText("More growth-oriented than your profile")).toBeTruthy();
  });
  it("leaves out sections that were not included", () => {
    render(<PortalPortfolioReview view={view({ accounts: null, mix: null, funds: null, reset: null, note: "" })} />);
    expect(screen.queryByText("Your accounts")).toBeNull();
    expect(screen.queryByText("Your mix")).toBeNull();
    expect(screen.queryByText(/Resetting your death/)).toBeNull();
  });
  it("labels a staff preview", () => {
    render(<PortalPortfolioReview view={view()} preview />);
    expect(screen.getByText("Preview: Your Portfolio Review")).toBeTruthy();
  });
});
