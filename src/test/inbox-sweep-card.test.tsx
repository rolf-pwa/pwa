import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

const calls: unknown[][] = [];
const forgot: string[] = [];
let data: any;
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/modules/crm/lib/inboxSweep", () => ({
  getSweep: async () => data,
  runSweep: async () => ({ ok: true, sorted: 0, remaining: 0 }),
  rateSweepItem: async (...a: unknown[]) => { calls.push(a); return { ok: true, moved: 1, remembered: "hello@justinwelsh.me" }; },
  forgetSweepSender: async (s: string) => { forgot.push(s); return { ok: true }; },
}));
import { InboxSweep } from "@/modules/crm/components/InboxSweep";

const item = (o: object = {}) => ({ id: "i1", message_id: "m1", from_addr: "Justin Welsh <hello@justinwelsh.me>", address: "hello@justinwelsh.me", subject: "Go make some friends.", snippet: "", received_at: "2026-10-19T17:00:00Z", bucket: "archivable", proposed_bucket: "archivable", correct_bucket: null, reason: "Newsletter or promotion", decided_by: "rule", feedback: null, link: "https://mail.google.com/x", ...o });

describe("the inbox sweep card", () => {
  beforeEach(() => { calls.length = 0; forgot.length = 0; data = { items: [item()], accuracy: { overall: null, archivable: null }, senders: [] }; });

  it("asks where a wrong sort belonged, and moves it there", async () => {
    render(<InboxSweep />);
    fireEvent.click(await screen.findByRole("tab", { name: /Would archive/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Sorted wrong" }));
    const chooser = screen.getByRole("group", { name: "Where should this have gone?" });
    expect(within(chooser).queryByRole("button", { name: "Would archive" })).toBeNull(); // it is already there
    fireEvent.click(within(chooser).getByRole("button", { name: "FYI" }));
    await waitFor(() => expect(calls).toEqual([["i1", "wrong", "fyi"]]));
  });

  it("marks a sort right in one click", async () => {
    render(<InboxSweep />);
    fireEvent.click(await screen.findByRole("tab", { name: /Would archive/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Sorted right" }));
    await waitFor(() => expect(calls).toEqual([["i1", "right", undefined]]));
  });

  it("says where a moved message was put, and clears the mark with another click", async () => {
    data = { ...data, items: [item({ bucket: "fyi", feedback: "wrong", correct_bucket: "fyi" })] };
    render(<InboxSweep />);
    fireEvent.click(await screen.findByRole("tab", { name: /FYI/ }));
    expect(await screen.findByText("You moved it to FYI")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Sorted wrong" }));
    await waitFor(() => expect(calls).toEqual([["i1", null, undefined]]));
  });

  it("lists what Georgia has learned and lets Rolf forget a sender", async () => {
    data = { ...data, senders: [{ sender: "hello@justinwelsh.me", bucket: "fyi" }] };
    render(<InboxSweep />);
    fireEvent.click(await screen.findByText(/What Georgia has learned from you \(1\)/));
    expect(screen.getByText("hello@justinwelsh.me: FYI")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Forget" }));
    await waitFor(() => expect(forgot).toEqual(["hello@justinwelsh.me"]));
  });
});
