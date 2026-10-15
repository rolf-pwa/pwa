import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const getInvite = vi.fn();
vi.mock("@/modules/crm/lib/onboardingAgent", () => ({ getInvite: (...a: unknown[]) => getInvite(...a), createInvite: vi.fn(), revokeInvite: vi.fn() }));
import { OnboardingInviteCard } from "@/modules/crm/components/OnboardingInviteCard";

describe("OnboardingInviteCard on the household information card", () => {
  it("shows as a highlighted strip with a way to make the link", async () => {
    getInvite.mockResolvedValue({ invite: null });
    render(<OnboardingInviteCard householdId="h1" embedded />);
    await waitFor(() => expect(screen.getByTestId("invite-strip")).toBeTruthy());
    expect(screen.getByText("Onboarding link")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Make an invitation link/ })).toBeTruthy();
  });
  it("shows the link and whether it has been opened", async () => {
    getInvite.mockResolvedValue({ invite: { id: "i", url: "https://app.prosperwise.ca/welcome/abc", state: "active", created_at: "2026-10-15T00:00:00Z", expires_at: "2026-11-14T00:00:00Z", first_clicked_at: null, click_count: 0, started_at: null, welcome_sent_to: 0, invitee: "Sam", recipients: ["a@x.ca"], no_email: false } });
    render(<OnboardingInviteCard householdId="h1" embedded />);
    await waitFor(() => expect(screen.getByTestId("invite-url").textContent).toContain("/welcome/abc"));
    expect(screen.getByText("Not opened yet.")).toBeTruthy();
  });
});
