// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { InvChecklistItem } from "@/modules/crm/lib/reviewAgent";

const MODELS = [{ profile_key: "balanced", label: "Balanced", income_min: 35, income_max: 55, equity_min: 45, equity_max: 65 }, { profile_key: "growth", label: "Growth", income_min: 20, income_max: 40, equity_min: 60, equity_max: 80 }];
const item = (kind: string, label: string, done: boolean, covered = false): InvChecklistItem => ({ kind, label, hint: "", requiredFor: ["new_sale"], done, covered });
const saved = vi.hoisted(() => ({ calls: [] as unknown[][] }));

vi.mock("@/modules/crm/lib/reviewAgent", () => ({
  getInvestmentProfiles: async () => ({ adults: [{ id: "a", name: "Justin Santos" }, { id: "b", name: "Lisa Santos" }], models: MODELS, profiles: [{ id: "p1", contact_id: "a", risk_profile: "balanced", note: null, pdf_url: null, created_at: "2026-10-24T18:00:00Z", created_by: "x", inputs: { objectives: ["growth"], timeHorizonYears: 15, amountToInvest: 100000, annualIncome: 90000, knowledge: "good", riskProfile: "balanced", riskProfileDate: "2026-10-24" } }] }),
  saveInvestmentProfile: async (...a: unknown[]) => { saved.calls.push(a); return { ok: true, id: "n" }; },
  fileInvestmentProfile: async () => ({ ok: true, url: "u" }),
  getInvestmentFiles: async () => ({
    adults: [], meetings: [], disclosure: { id: "d", status: "signed", sentAt: "2026-10-20T00:00:00Z", signedAt: "2026-10-21T00:00:00Z" },
    files: [{ id: "f", contact_id: null, title: "Justin Santos, RRSP", kind: "new_sale", status: "open", opened_at: "2026-10-24T00:00:00Z", items: [], optional: [],
      progress: { required: 6, done: 4, complete: false },
      checklist: [item("advisor_disclosure", "Advisor disclosure", true, true), item("privacy_consent", "Privacy consent", true, true), item("casl_consent", "CASL consent", true, true), item("fact_find", "Fact find, needs analysis and risk tolerance", true, true), item("reason_why", "Reason why letter", false), item("advisor_notes", "Advisor notes", false)] }],
  }),
  attachInvestmentItem: async () => ({ ok: true }), createInvestmentFile: async () => ({ ok: true, id: "x" }), removeInvestmentItem: async () => ({ ok: true }),
  previewInsuranceDoc: async () => ({}), sendInsuranceDoc: async () => ({}),
}));
vi.mock("@/shared/integrations/supabase/client", () => ({ supabase: { from: () => ({ select: () => ({ eq: async () => ({ data: [] }) }) }) } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { InvestmentCompliance } from "../modules/investments/InvestmentCompliance";
import { InvestorProfile } from "../modules/investments/InvestorProfile";

describe("the investor profile page", () => {
  it("shows each adult side by side, starting from the last saved version, with the risk profile chosen from iA's models", async () => {
    render(<InvestorProfile householdId="h" />);
    await waitFor(() => expect(screen.getByTestId("profile-a")).toBeTruthy());
    expect(screen.getByTestId("profile-b")).toBeTruthy();
    expect(screen.getByTestId("investor-profile").querySelector(".lg\\:grid-cols-2")).toBeTruthy();
    const justin = screen.getByTestId("profile-a");
    expect((justin.querySelector('select[aria-label="Risk profile"]') as HTMLSelectElement).value).toBe("balanced");
    expect(justin.textContent).toContain("iA model portfolio: 35% to 55% fixed income, 45% to 65% equity.");
    expect(screen.getByTestId("profile-b").textContent).toContain("Still to fill in: the objectives");
    expect(justin.textContent).toContain("Saved versions");
  });
  it("saves a version for the person", async () => {
    render(<InvestorProfile householdId="h" />);
    await waitFor(() => expect(screen.getByTestId("profile-b")).toBeTruthy());
    const btns = Array.from(screen.getByTestId("profile-b").querySelectorAll("button")).filter((b) => b.textContent === "Save profile");
    fireEvent.click(btns[0]);
    await waitFor(() => expect(saved.calls.length).toBe(1));
    expect(saved.calls[0][0]).toBe("h"); expect(saved.calls[0][1]).toBe("b");
  });
});

describe("the compliance roadmap", () => {
  it("shows the shared disclosure as signed and marks the items it and the profile cover", async () => {
    render(<MemoryRouter><InvestmentCompliance householdId="h" stage="needs_analysis" /></MemoryRouter>);
    await waitFor(() => expect(screen.getByTestId("investment-compliance")).toBeTruthy());
    expect(screen.getByTestId("disclosure-card").textContent).toContain("Signed");
    expect(screen.getByTestId("disclosure-card").textContent).toContain("shared with Insurance");
    expect(screen.getAllByText(/covered by the client's signed disclosure/).length).toBe(3);
    expect(screen.getByText(/covered by a saved investor profile/)).toBeTruthy();
    expect(screen.getByTestId("progress-panel").textContent).toContain("Advisor notes"); // the next thing due at this stage; the letter is for Recommendation
    expect(screen.getByLabelText("67% complete")).toBeTruthy();
  });
});
