// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { act, fireEvent, render, renderHook, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const kb = vi.hoisted(() => ({ state: { height: null as number | null, keyboardOpen: false } }));
const invoke = vi.hoisted(() => vi.fn());
vi.mock("@/shared/hooks/useKeyboardViewport", async (orig) => ({ ...(await orig<typeof import("@/shared/hooks/useKeyboardViewport")>()), useKeyboardViewport: () => kb.state }));
vi.mock("@/shared/hooks/useAttentionCounts", () => ({ useAttentionCounts: () => ({ inbox: 0, requests: 0, review: 0 }) }));
vi.mock("@/shared/components/NotificationBell", () => ({ NotificationBell: () => <span /> }));
vi.mock("@/shared/integrations/supabase/client", () => ({ supabase: { functions: { invoke: (...a: any[]) => invoke(...a) } } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { MobileShell } from "@/shared/components/MobileShell";
import { EaChat } from "@/modules/crm/components/EaChat";
import { keyboardIsOpen, useKeyboardViewport } from "@/shared/hooks/useKeyboardViewport";

const at = (path: string, ui: React.ReactNode) => render(<MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>);

describe("knowing the keyboard is up", () => {
  it("is when much less of the screen is visible than the page thinks it has", () => {
    expect(keyboardIsOpen(800, 790)).toBe(false); // the browser's own bars
    expect(keyboardIsOpen(800, 450)).toBe(true);
  });
  it("follows the visual viewport as it shrinks and grows, and sends the page back to the top", async () => {
    const real = await vi.importActual<typeof import("@/shared/hooks/useKeyboardViewport")>("@/shared/hooks/useKeyboardViewport");
    const listeners: Record<string, () => void> = {};
    const vv = { height: 780, addEventListener: (e: string, f: () => void) => { listeners[e] = f; }, removeEventListener: vi.fn() };
    Object.defineProperty(window, "visualViewport", { configurable: true, value: vv });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });
    const scroll = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    const { result } = renderHook(() => real.useKeyboardViewport());
    expect(result.current).toEqual({ height: 780, keyboardOpen: false });
    act(() => { vv.height = 430; listeners.resize(); });
    expect(result.current).toEqual({ height: 430, keyboardOpen: true });
    expect(scroll).toHaveBeenCalledWith(0, 0);
    act(() => { vv.height = 780; listeners.resize(); });
    expect(result.current.keyboardOpen).toBe(false);
    scroll.mockRestore();
    Object.defineProperty(window, "visualViewport", { configurable: true, value: undefined });
  });
  it("does nothing where there is no visual viewport", () => {
    expect(renderHook(() => useKeyboardViewport()).result.current).toEqual({ height: null, keyboardOpen: false });
  });
});

describe("the shell with the keyboard", () => {
  beforeEach(() => { kb.state = { height: null, keyboardOpen: false }; });
  it("keeps the bottom bar and the full-height page when the keyboard is down", () => {
    at("/briefing", <MobileShell>x</MobileShell>);
    expect(screen.getByTestId("mobile-tabs")).toBeTruthy();
    expect(screen.getByTestId("mobile-shell").getAttribute("style")).toBeNull();
  });
  it("is as tall as what shows and drops the bottom bar when the keyboard is up, so the field sits right above it", () => {
    kb.state = { height: 430, keyboardOpen: true };
    at("/georgia", <MobileShell>x</MobileShell>);
    expect(screen.queryByTestId("mobile-tabs")).toBeNull();
    expect(screen.getByTestId("mobile-shell").style.height).toBe("430px");
  });
  it("gives Georgia the whole screen between the bars, scrolling inside the chat rather than the page", () => {
    at("/georgia", <MobileShell>x</MobileShell>);
    const main = screen.getByTestId("mobile-main");
    expect(main.className).toContain("flex-col");
    expect(main.className).toContain("overflow-hidden");
    expect(main.className).not.toContain("px-4");
    at("/contacts", <MobileShell>y</MobileShell>);
    expect(screen.getAllByTestId("mobile-main")[1].className).toContain("overflow-y-auto"); // every other page scrolls as a page
  });
});

describe("the chat filling the phone", () => {
  beforeEach(() => {
    invoke.mockReset();
    invoke.mockImplementation(async (_f: string, { body }: any) => {
      if (body.action === "ea_history") return { data: { messages: [{ id: "m1", role: "assistant", content: "Good morning, Rolf.", actions: [{ id: "a1", kind: "email_draft", status: "proposed", summary: "Email draft: Friday", payload: { to: "e@x.ca", subject: "Friday", body: "Hello", url: "https://mail.google.com/x" } }] }], preferences: [] }, error: null };
      if (body.action === "ea_chat") return { data: { message: { id: "m2", role: "assistant", content: "Done.", actions: [] } }, error: null };
      return { data: { ok: true }, error: null };
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it("has no card and no title, a message field and Send you can tap, and action buttons big enough for a finger", async () => {
    at("/georgia", <EaChat fill />);
    const chat = await screen.findByTestId("ea-chat");
    expect(chat.className).toContain("flex-1");
    expect(chat.className).not.toContain("max-h-[80vh]");
    expect(screen.queryByText("Morning meeting with Georgia")).toBeNull();
    const field = screen.getByLabelText("Message to Georgia");
    expect(field.className).toContain("h-11");
    expect(field.getAttribute("enterkeyhint")).toBe("send");
    expect(screen.getByRole("button", { name: "Send" }).className).toContain("h-11");
    expect(within(chat).getByRole("button", { name: "Dismiss" }).className).toContain("h-10");
    expect(within(chat).getByText("Good morning, Rolf.")).toBeTruthy();
  });
  it("stays a card with a title beside Today on a desktop", async () => {
    at("/briefing", <EaChat />);
    const chat = await screen.findByTestId("ea-chat");
    expect(chat.className).toContain("max-h-[80vh]");
    expect(screen.getByText("Morning meeting with Georgia")).toBeTruthy();
  });
  it("sends what you type, and keeps the latest message in view when the field is tapped", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const scrolled = vi.fn();
    (window.HTMLElement.prototype as any).scrollIntoView = scrolled;
    at("/georgia", <EaChat fill />);
    const field = await screen.findByLabelText("Message to Georgia");
    fireEvent.focus(field);
    act(() => { vi.advanceTimersByTime(400); });
    expect(scrolled).toHaveBeenCalled();
    fireEvent.change(field, { target: { value: "Plan the meeting" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("daily-briefing-generate", { body: { action: "ea_chat", message: "Plan the meeting", start: false } }));
    vi.useRealTimers();
  });
  it("is the whole page on the Georgia route", () => {
    const page = readFileSync("src/modules/crm/pages/GeorgiaPage.tsx", "utf8");
    expect(page).toContain("<EaChat fill />");
  });
});
