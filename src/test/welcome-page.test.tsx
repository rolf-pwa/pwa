import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const invoke = vi.fn();
vi.mock("@/shared/integrations/supabase/client", () => ({ supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } } }));
import Welcome, { WEBSITE_URL } from "@/modules/intake/pages/Welcome";

describe("Welcome page", () => {
  const replace = vi.fn();
  beforeEach(() => {
    invoke.mockReset(); replace.mockReset();
    Object.defineProperty(window, "location", { value: { replace }, writable: true });
  });
  const mount = () => render(<MemoryRouter initialEntries={["/welcome/tok123"]}><Routes><Route path="/welcome/:token" element={<Welcome />} /></Routes></MemoryRouter>);

  it("records the click then goes to the website", async () => {
    invoke.mockResolvedValue({ data: { ok: true } });
    mount();
    await waitFor(() => expect(replace).toHaveBeenCalledWith(WEBSITE_URL));
    expect(invoke).toHaveBeenCalledWith("intake-portal", { body: { action: "invite_click", token: "tok123" } });
  });

  it("still goes to the website when the server fails", async () => {
    invoke.mockRejectedValue(new Error("down"));
    mount();
    await waitFor(() => expect(replace).toHaveBeenCalledWith(WEBSITE_URL));
  });
});
