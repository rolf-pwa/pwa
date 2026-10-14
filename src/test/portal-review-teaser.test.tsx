import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PortalReviewTeaser, PortalReviewPage, reviewSeen } from "@/modules/portal/components/PortalReviewTeaser";
import type { ClientView } from "../../supabase/functions/_shared/portfolio-review-client";

const view = (): ClientView => ({
  householdLabel: "Parent Household", valuesAsOf: "2026-09-30", note: "", summary: { value: 532_937, changeYtd: -9_616, ytdPct: 5 }, history: [], accounts: null, mix: null, funds: null, reset: null, disclosures: ["Past performance does not guarantee future results."],
});

describe("the dashboard pointer to the Portfolio Review", () => {
  beforeEach(() => localStorage.clear());
  it("is one highlighted container with the headline and a button, marked New until the review is opened", () => {
    const onOpen = vi.fn();
    render(<PortalReviewTeaser id="p1" view={view()} publishedAt="2026-10-20T16:00:00Z" onOpen={onOpen} />);
    expect(screen.getByText("Your Portfolio Review is ready")).toBeTruthy();
    expect(screen.getByText("New")).toBeTruthy();
    expect(screen.getByText(/\$532,937/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /View your review/ }));
    expect(onOpen).toHaveBeenCalled();
  });
  it("shows the review on its own page and clears the New badge once opened", () => {
    render(<PortalReviewPage review={{ id: "p1", view: view(), publishedAt: "2026-10-20T16:00:00Z" }} onBack={() => {}} />);
    expect(screen.getByText("Your Portfolio Review")).toBeTruthy();
    expect(reviewSeen("p1")).toBe(true);
    render(<PortalReviewTeaser id="p1" view={view()} publishedAt="2026-10-20T16:00:00Z" onOpen={() => {}} />);
    expect(screen.queryByText("New")).toBeNull();
  });
  it("says so when there is no review, and goes back", () => {
    const onBack = vi.fn();
    render(<PortalReviewPage review={null} onBack={onBack} />);
    expect(screen.getByText(/no Portfolio Review to show/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Back to your portal/ }));
    expect(onBack).toHaveBeenCalled();
  });
});
