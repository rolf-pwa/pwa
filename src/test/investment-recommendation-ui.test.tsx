// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const MODELS = [
  { profile_key: "balanced", label: "Balanced", income_min: 35, income_max: 55, equity_min: 45, equity_max: 65, as_of: "2026-05-31", funds: [{ name: "Fidelity Insights", weight: 20 }, { name: "Fixed income managed portfolio (iA)", weight: 40 }] },
  { profile_key: "growth", label: "Growth", income_min: 20, income_max: 40, equity_min: 60, equity_max: 80, as_of: "2026-05-31", funds: [] },
];
const calls = vi.hoisted(() => ({ saved: [] as unknown[][], sent: [] as unknown[][], letter: "# Reason Why\n\nInvest ____ in the iA Balanced model." }));
vi.mock("@/modules/crm/lib/reviewAgent", () => ({
  getInvestmentRecs: async () => ({ models: MODELS, people: [
    { id: "a", name: "Justin Santos", riskProfile: "balanced", suggestedReason: "You told me you want to grow capital.", rec: { id: "r1", contact_id: "a", profile_key: "balanced", model_as_of: null, amount: 100000, accounts: "RRSP", guarantee: "g", fees: "f", reason: "because", deviation_reason: null, letter_document_id: "d1", created_at: "2026-10-24T00:00:00Z", letter: { id: "d1", status: "sent", sent_at: "2026-10-24T00:00:00Z", completed_at: null, pdf_url: null } } },
    { id: "b", name: "Lisa Santos", riskProfile: null, suggestedReason: "", rec: null },
  ] }),
  saveInvestmentRec: async (...a: unknown[]) => { calls.saved.push(a); return { ok: true, id: "n" }; },
  draftInvestmentLetter: async () => ({ ok: true, md: calls.letter, blanks: 1 }),
  sendInvestmentLetter: async (...a: unknown[]) => { calls.sent.push(a); return { ok: true, documentId: "x" }; },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { InvestmentRecommendation } from "../modules/investments/InvestmentRecommendation";

describe("the recommendation page", () => {
  it("shows people side by side, the model's funds largest first, and warns when there is no risk profile yet", async () => {
    render(<InvestmentRecommendation householdId="h" />);
    await waitFor(() => expect(screen.getByTestId("rec-a")).toBeTruthy());
    const funds = screen.getByTestId("rec-a").querySelector('[data-testid="model-funds"]')!.textContent!;
    expect(funds.indexOf("Fixed income managed")).toBeLessThan(funds.indexOf("Fidelity Insights"));
    expect(funds).toContain("35% to 55% fixed income");
    expect(screen.getByTestId("investment-recommendation").querySelector(".lg\\:grid-cols-2")).toBeTruthy();
    expect(screen.getByTestId("rec-b").querySelector('[data-testid="no-risk-profile"]')).toBeTruthy();
    expect(screen.getByTestId("letter-status").textContent).toContain("Waiting on the client to confirm");
  });
  it("asks for a reason when another portfolio is chosen, and starts new reasons from the profile", async () => {
    render(<InvestmentRecommendation householdId="h" />);
    await waitFor(() => expect(screen.getByTestId("rec-a")).toBeTruthy());
    const a = screen.getByTestId("rec-a");
    expect(a.textContent).not.toContain("Why not the Balanced portfolio");
    fireEvent.change(a.querySelector('select[aria-label="Model portfolio"]') as HTMLSelectElement, { target: { value: "growth" } });
    await waitFor(() => expect(a.textContent).toContain("Why not the Balanced portfolio"));
    expect((screen.getByTestId("rec-b").querySelector('textarea[aria-label="Why this suits the client"]') as HTMLTextAreaElement).value).toBe("");
  });
  it("will not send a letter that still has blanks", async () => {
    render(<InvestmentRecommendation householdId="h" />);
    await waitFor(() => expect(screen.getByTestId("rec-a")).toBeTruthy());
    fireEvent.click(screen.getByText("Draft the reason why letter"));
    await waitFor(() => expect(screen.getByTestId("letter-editor")).toBeTruthy());
    expect(screen.getByTestId("letter-blanks").textContent).toContain("1 blank");
    expect((screen.getByText("Send to the client portal").closest("button") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("The reason why letter"), { target: { value: "# Reason Why\n\nInvest $100,000 in the iA Balanced model." } });
    await waitFor(() => expect((screen.getByText("Send to the client portal").closest("button") as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByText("Send to the client portal"));
    await waitFor(() => expect(calls.sent.length).toBe(1));
    expect(calls.sent[0][0]).toBe("r1");
  });
});
