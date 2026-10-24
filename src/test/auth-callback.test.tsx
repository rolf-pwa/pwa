import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";

type Listener = (event: string, session: { user: { email: string } } | null) => void;
const state = { session: null as null | { user: { email: string } }, listener: null as Listener | null, invoke: vi.fn() };

vi.mock("@/shared/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: state.session } }),
      onAuthStateChange: (cb: Listener) => { state.listener = cb; return { data: { subscription: { unsubscribe: () => {} } } }; },
    },
    functions: { invoke: (...a: unknown[]) => state.invoke(...a) },
  },
}));

import AuthCallback from "@/pages/AuthCallback";

const harness = () => render(
  <MemoryRouter initialEntries={["/"]}>
    <Routes>
      <Route path="/" element={<AuthCallback />} />
      <Route path="/portal" element={<p>PORTAL</p>} />
      <Route path="/briefing" element={<p>TODAY</p>} />
      <Route path="/access-denied" element={<p>NO ACCOUNT</p>} />
      <Route path="/login" element={<p>LOGIN</p>} />
    </Routes>
  </MemoryRouter>,
);

const client = { user: { email: "irene@example.com" } };

describe("signing in with Google", () => {
  beforeEach(() => { state.session = null; state.listener = null; state.invoke = vi.fn(); sessionStorage.clear(); window.location.hash = "#access_token=abc"; });
  afterEach(() => { vi.useRealTimers(); window.location.hash = ""; });

  it("waits for a slow portal instead of giving up after a few seconds", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    state.invoke = vi.fn(() => new Promise((res) => setTimeout(() => res({ data: { contact: { id: "c" } }, error: null }), 12_000)));
    harness();
    await waitFor(() => expect(state.listener).not.toBeNull());
    act(() => state.listener!("SIGNED_IN", client));
    await act(async () => { await vi.advanceTimersByTimeAsync(7_000); });
    expect(screen.getByText("Signing in...")).toBeTruthy(); // 7 seconds in: still working, not sent to a "No Account Found" page
    await act(async () => { await vi.advanceTimersByTimeAsync(6_000); });
    expect(await screen.findByText("PORTAL")).toBeTruthy();
    expect(sessionStorage.getItem("portal_google_auth")).toContain("contact");
  });

  it("calls the portal once even when sign-in and token-refresh events arrive together", async () => {
    state.invoke = vi.fn(async () => ({ data: { contact: { id: "c" } }, error: null }));
    harness();
    await waitFor(() => expect(state.listener).not.toBeNull());
    act(() => { state.listener!("SIGNED_IN", client); state.listener!("TOKEN_REFRESHED", client); });
    expect(await screen.findByText("PORTAL")).toBeTruthy();
    expect(state.invoke).toHaveBeenCalledTimes(1);
  });

  it("sends a client with no account to the no-account page", async () => {
    state.invoke = vi.fn(async () => ({ data: null, error: { context: { status: 404, json: async () => ({ error: "No account found for this email" }) } } }));
    harness();
    await waitFor(() => expect(state.listener).not.toBeNull());
    act(() => state.listener!("SIGNED_IN", client));
    expect(await screen.findByText("NO ACCOUNT")).toBeTruthy();
  });

  it("does not call a failed connection 'no account': it offers to try again, and tries once more on its own first", async () => {
    let calls = 0;
    state.invoke = vi.fn(async () => { calls++; return calls < 3 ? { data: null, error: { context: { status: 500, json: async () => ({ error: "Server error" }) } } } : { data: { contact: { id: "c" } }, error: null }; });
    harness();
    await waitFor(() => expect(state.listener).not.toBeNull());
    act(() => state.listener!("SIGNED_IN", client));
    expect(await screen.findByText(/couldn't open your portal/)).toBeTruthy(); // two quiet attempts failed
    expect(screen.queryByText("NO ACCOUNT")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("PORTAL")).toBeTruthy();
  });

  it("sends staff on to Today without asking the portal", async () => {
    harness();
    await waitFor(() => expect(state.listener).not.toBeNull());
    act(() => state.listener!("SIGNED_IN", { user: { email: "rolf@prosperwise.ca" } }));
    expect(await screen.findByText("TODAY")).toBeTruthy();
    expect(state.invoke).not.toHaveBeenCalled();
  });
});
