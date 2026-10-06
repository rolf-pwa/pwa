// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useAutoSave } from "../shared/hooks/useAutoSave";

// The Sovereignty Review edits its data in place and never calls markDirty, so it must use autoDetectDirty:
// without it, edits were never saved.
describe("useAutoSave as the Sovereignty Review uses it", () => {
  const setup = (autoDetectDirty: boolean) => {
    const onSave = vi.fn().mockResolvedValue(true);
    const hook = renderHook(({ data }) => useAutoSave({ data, enabled: true, onSave, delay: 50, autoDetectDirty }), { initialProps: { data: { summary: "a" } } });
    return { onSave, hook };
  };

  it("saves an edit with autoDetectDirty on", async () => {
    vi.useFakeTimers();
    const { onSave, hook } = setup(true);
    hook.rerender({ data: { summary: "edited" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(onSave).toHaveBeenCalledWith({ summary: "edited" });
    vi.useRealTimers();
  });

  it("does not save when nothing changed", async () => {
    vi.useFakeTimers();
    const { onSave } = setup(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(onSave).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("without it, an in-place edit is never saved (the bug)", async () => {
    vi.useFakeTimers();
    const { onSave, hook } = setup(false);
    hook.rerender({ data: { summary: "edited" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(onSave).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
