import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const invoke = vi.fn();
vi.mock("@/shared/integrations/supabase/client", () => ({ supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } } }));

import { useBookingWatcher, checkMeetingBookings } from "@/modules/portal/lib/useBookingWatcher";

describe("booking watcher", () => {
  beforeEach(() => { vi.useFakeTimers(); invoke.mockReset(); });
  afterEach(() => { vi.useRealTimers(); });

  it("returns nothing when the server finds nothing or errors", async () => {
    invoke.mockResolvedValueOnce({ data: { ok: true, found: [] }, error: null });
    expect(await checkMeetingBookings("tok")).toEqual([]);
    invoke.mockResolvedValueOnce({ data: null, error: new Error("x") });
    expect(await checkMeetingBookings("tok")).toEqual([]);
    expect(await checkMeetingBookings("")).toEqual([]);
  });

  it("does nothing while the scheduler is closed", async () => {
    renderHook(() => useBookingWatcher({ portalToken: "tok", active: false, onFound: vi.fn() }));
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("checks every ten seconds while open and stops once a meeting is found", async () => {
    const onFound = vi.fn();
    invoke.mockResolvedValueOnce({ data: { found: [] }, error: null }).mockResolvedValueOnce({ data: { found: [{ label: "Governance Review", start: "2026-11-02T18:00:00Z" }] }, error: null });
    renderHook(() => useBookingWatcher({ portalToken: "tok", active: true, onFound }));
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(onFound).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(onFound).toHaveBeenCalledWith([{ label: "Governance Review", start: "2026-11-02T18:00:00Z" }]);
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it("checks once more the moment it closes, and again a few seconds later", async () => {
    invoke.mockResolvedValue({ data: { found: [] }, error: null });
    const { rerender } = renderHook(({ active }) => useBookingWatcher({ portalToken: "tok", active, onFound: vi.fn() }), { initialProps: { active: true } });
    rerender({ active: false });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(invoke).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(6_000); });
    expect(invoke).toHaveBeenCalledTimes(2);
  });
});
