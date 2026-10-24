// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ saved: [] as unknown[][], sent: [] as unknown[][] }));
const win = (state: "unset" | "open" | "closed", endsOn: string | null, daysLeft: number | null) => ({ state, endsOn, daysLeft });
const row = (o: object) => ({ id: "c1", contact_id: "a", contract_number: "IA-77", accounts: "RRSP", amount: 100000, application_url: null, application_name: null, contract_url: null, contract_name: null, issued_on: "2026-10-22", confirmation_received_on: "2026-10-23", cancel_business_days: 2, cancel_ends_on: "2026-10-27", fund_facts_on: "2026-10-22", fund_facts_note: null, letter_document_id: null, created_at: "2026-10-24T00:00:00Z", window: win("open", "2026-10-27", 1), letter: null, ...o });
vi.mock("@/modules/crm/lib/reviewAgent", () => ({
  getInvestmentContracts: async () => ({ people: [{ id: "a", name: "Justin Santos" }, { id: "b", name: "Lisa Santos" }], recommendations: [], contracts: [row({}), row({ id: "c2", contact_id: "a", contract_number: "IA-78", window: win("closed", "2026-10-20", null), letter: { id: "d", status: "signed", sent_at: "x", completed_at: "y", pdf_url: "https://d/1" } })] }),
  saveInvestmentContract: async (...a: unknown[]) => { calls.saved.push(a); return { ok: true, id: "n" }; },
  draftDeliveryLetterApi: async () => ({ ok: true, md: "# Letter\n\nInvested ____.", blanks: 1 }),
  sendDeliveryLetterApi: async (...a: unknown[]) => { calls.sent.push(a); return { ok: true, documentId: "x" }; },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { InvestmentApplication } from "../modules/investments/InvestmentApplication";

describe("the application and delivery page", () => {
  it("shows people side by side, each contract with where its right-to-cancel window stands, and a blank form for someone with no contract", async () => {
    render(<InvestmentApplication householdId="h" />);
    await waitFor(() => expect(screen.getByTestId("contract-c1")).toBeTruthy());
    expect(screen.getByTestId("investment-application").querySelector(".lg\\:grid-cols-2")).toBeTruthy();
    expect(screen.getByTestId("contract-c1").textContent).toContain("Right to cancel open until October 27, 2026 (1 day left)");
    expect(screen.getByTestId("contract-c2").textContent).toContain("Right to cancel ended October 20, 2026");
    expect(screen.getByTestId("contract-c2").textContent).toContain("Confirmed by the client");
    expect(screen.getByTestId("new-contract-b")).toBeTruthy();
    expect(screen.getByText("Add another contract for Justin Santos")).toBeTruthy();
  });
  it("saves changes for the right person and contract", async () => {
    render(<InvestmentApplication householdId="h" />);
    await waitFor(() => expect(screen.getByTestId("contract-c1")).toBeTruthy());
    fireEvent.change(screen.getByTestId("contract-c1").querySelector('input[aria-label="Business days to cancel"]') as HTMLInputElement, { target: { value: "3" } });
    fireEvent.click(Array.from(screen.getByTestId("contract-c1").querySelectorAll("button")).find((b) => b.textContent === "Save changes")!);
    await waitFor(() => expect(calls.saved.length).toBe(1));
    expect(calls.saved[0][0]).toBe("h"); expect(calls.saved[0][1]).toBe("a"); expect((calls.saved[0][2] as any).cancelBusinessDays).toBe(3); expect(calls.saved[0][3]).toBe("c1");
  });
  it("will not send a delivery letter that still has blanks", async () => {
    render(<InvestmentApplication householdId="h" />);
    await waitFor(() => expect(screen.getByTestId("contract-c1")).toBeTruthy());
    fireEvent.click(Array.from(screen.getByTestId("contract-c1").querySelectorAll("button")).find((b) => b.textContent === "Draft the delivery letter")!);
    await waitFor(() => expect(screen.getByTestId("letter-editor")).toBeTruthy());
    expect((screen.getByText("Send to the client portal").closest("button") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("The delivery letter"), { target: { value: "# Letter\n\nInvested $100,000." } });
    await waitFor(() => expect((screen.getByText("Send to the client portal").closest("button") as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByText("Send to the client portal"));
    await waitFor(() => expect(calls.sent.length).toBe(1));
    expect(calls.sent[0][0]).toBe("c1");
  });
});
