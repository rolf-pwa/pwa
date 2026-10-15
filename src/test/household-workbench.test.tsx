import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const getFacts = vi.fn();
vi.mock("@/modules/crm/lib/reviewAgent", () => ({ getWorkbenchFacts: (...a: unknown[]) => getFacts(...a) }));
import { HouseholdWorkbench } from "@/modules/crm/components/HouseholdWorkbench";
import type { StepKey } from "@/modules/crm/lib/workbenchSteps";

const KEYS: StepKey[] = ["guided_intake", "stabilization_map", "portfolio_review", "sovereignty_review", "governance_audit", "charter", "causal_ai"];
const actions = Object.fromEntries(KEYS.map((k) => [k, <button key={k}>{`do ${k}`}</button>])) as Record<StepKey, React.ReactNode>;
const mount = (over: Partial<{ onboardingComplete: boolean; charterStarted: boolean; today: string }> = {}) =>
  render(<HouseholdWorkbench householdId="h1" onboardingComplete charterStarted={false} today="2027-05-10" actions={actions} {...over} />);

describe("HouseholdWorkbench", () => {
  beforeEach(() => { getFacts.mockReset(); });

  it("shows the Portfolio Review for a Tier 2A household in its window and tucks the rest under More tools with reasons", async () => {
    getFacts.mockResolvedValue({ tier: "tier_2a", hasRatifiedCharter: false, publishedReview: false, obligations: [{ kind: "annual_review", window_start: "2027-04-01", window_end: "2027-06-30", status: "open" }] });
    mount();
    await waitFor(() => expect(screen.getByRole("button", { name: "do portfolio_review" })).toBeTruthy());
    expect(screen.queryByRole("button", { name: "do charter" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /More tools \(\d\)/ }));
    expect(screen.getByRole("button", { name: "do charter" })).toBeTruthy();
    expect(screen.getAllByText("No Charter, and below Tier 2B").length).toBe(2);
    expect(screen.getAllByText("Onboarding is complete").length).toBe(2);
  });

  it("hides the Portfolio Review outside its window, saying when it opens", async () => {
    getFacts.mockResolvedValue({ tier: "tier_2a", hasRatifiedCharter: false, publishedReview: false, obligations: [{ kind: "annual_review", window_start: "2027-10-01", window_end: "2027-12-31", status: "open" }] });
    mount({ today: "2027-05-10" });
    await waitFor(() => expect(screen.getByText(/More tools/)).toBeTruthy());
    expect(screen.queryByRole("button", { name: "do portfolio_review" })).toBeNull();
    fireEvent.click(screen.getByText(/More tools/));
    expect(screen.getByText("Next review window opens Oct 1")).toBeTruthy();
  });

  it("shows the onboarding steps while onboarding is not complete", async () => {
    getFacts.mockResolvedValue({ tier: "tier_1", hasRatifiedCharter: false, publishedReview: false, obligations: [] });
    mount({ onboardingComplete: false });
    await waitFor(() => expect(screen.getByRole("button", { name: "do guided_intake" })).toBeTruthy());
    expect(screen.getByRole("button", { name: "do stabilization_map" })).toBeTruthy();
  });

  it("shows everything tier- and window-based when the facts cannot be loaded", async () => {
    getFacts.mockImplementation(() => Promise.reject(new Error("down")));
    mount();
    await waitFor(() => expect(screen.getByRole("button", { name: "do portfolio_review" })).toBeTruthy());
    expect(screen.getByRole("button", { name: "do charter" })).toBeTruthy();
  });
});
