import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const invoke = vi.fn();
let n = 0;
vi.mock("@/shared/integrations/supabase/client", () => ({ supabase: { functions: { invoke: (...a: any[]) => invoke(...a) } } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { EaChat } from "@/modules/crm/components/EaChat";

const proposal = { id: "a1", kind: "calendar_proposal", status: "proposed", summary: "Calendar: Board Meeting", payload: { title: "Board Meeting", start: "2026-10-23T15:30", end: "2026-10-23T17:00", location: "The Pub", url: "https://calendar.google.com/calendar/render?x=1" } };
const email = { id: "a2", kind: "email_draft", status: "proposed", summary: "Email draft: Friday", payload: { to: "events@pub.ca", subject: "Board meeting Friday", body: "Do you have space?\nRolf", url: "https://mail.google.com/mail/?view=cm" } };
const task = { id: "a3", kind: "task_created", status: "done", summary: "Task: Confirm venue (due 2026-10-21)", payload: {} };
const pref = { id: "a4", kind: "preference", status: "done", summary: "I will stop showing mail from Venn", payload: { id: "p1" } };

describe("the morning meeting chat", () => {
  beforeEach(() => {
    invoke.mockReset();
    invoke.mockImplementation(async (_f: string, { body }: any) => {
      if (body.action === "ea_history") return { data: { messages: [], preferences: [] }, error: null };
      if (body.action === "ea_chat") return { data: { message: { id: `m${++n}`, role: "assistant", content: body.start ? "Good morning, Rolf. Three things today." : "Done. Here is what I prepared.", actions: body.start ? [] : [task, proposal, email, pref] } }, error: null };
      return { data: { ok: true }, error: null };
    });
  });

  it("opens with a button to start the meeting, then shows Georgia's opening", async () => {
    render(<EaChat />);
    fireEvent.click(await screen.findByRole("button", { name: "Start the morning meeting" }));
    expect(await screen.findByText(/Good morning, Rolf/)).toBeTruthy();
    expect(invoke).toHaveBeenCalledWith("daily-briefing-generate", { body: { action: "ea_chat", message: "", start: true } });
  });

  it("shows what she did, and what she prepared for him to use", async () => {
    render(<EaChat />);
    fireEvent.click(await screen.findByRole("button", { name: "Start the morning meeting" }));
    await screen.findByText(/Good morning/);
    fireEvent.change(screen.getByLabelText("Message to Georgia"), { target: { value: "Plan the board meeting" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText(/Task: Confirm venue/)).toBeTruthy();
    const cal = screen.getByTestId("calendar-proposal");
    expect(cal.textContent).toContain("Board Meeting");
    expect(cal.querySelector("a")?.getAttribute("href")).toContain("calendar.google.com");
    const mail = screen.getByTestId("email-draft");
    expect(mail.textContent).toContain("Board meeting Friday");
    expect(mail.querySelector("a")?.getAttribute("href")).toContain("mail.google.com");
    // Nothing in either card sends or adds by itself: both are links Rolf clicks.
    expect(screen.queryByRole("button", { name: /send now/i })).toBeNull();
  });

  it("records that he used or dismissed a proposal", async () => {
    render(<EaChat />);
    fireEvent.click(await screen.findByRole("button", { name: "Start the morning meeting" }));
    await screen.findByText(/Good morning/);
    fireEvent.change(screen.getByLabelText("Message to Georgia"), { target: { value: "go" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await screen.findByTestId("email-draft");
    fireEvent.click(screen.getAllByRole("button", { name: "Dismiss" })[1]);
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("daily-briefing-generate", { body: { action: "ea_decide", actionId: "a2", decision: "dismissed" } }));
    expect(await screen.findByText("Dismissed")).toBeTruthy();
  });

  it("lets him undo something she was asked to remember", async () => {
    render(<EaChat />);
    fireEvent.click(await screen.findByRole("button", { name: "Start the morning meeting" }));
    await screen.findByText(/Good morning/);
    fireEvent.change(screen.getByLabelText("Message to Georgia"), { target: { value: "stop showing Venn" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    fireEvent.click(await screen.findByRole("button", { name: "Undo" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("daily-briefing-generate", { body: { action: "ea_forget", prefId: "p1" } }));
  });
});
