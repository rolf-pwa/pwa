import { describe, expect, it } from "vitest";
import { buildActionEvent, computeDelta, feedbackSignal } from "../../supabase/functions/_shared/action-brain";

describe("computeDelta / feedbackSignal", () => {
  const ai = { accounts: [{ account_number: "A1", current_value: 100, book_value: 90, source: { page_number: 1 } }] };
  it("is 0 for an exact accept and ignores provenance", () => {
    expect(computeDelta(ai, { accounts: [{ account_number: "A1", current_value: 100, book_value: 90, source: { page_number: 9 } }] })).toBe(0);
  });
  it("is the fraction of fields the human changed", () => {
    expect(computeDelta(ai, { accounts: [{ account_number: "A1", current_value: 120, book_value: 90 }] })).toBeCloseTo(1 / 3, 3);
  });
  it("counts added and removed fields", () => {
    expect(computeDelta({ a: 1 }, { a: 1, b: 2 })).toBe(0.5);
    expect(computeDelta({}, {})).toBe(0);
  });
  it("buckets the signal", () => {
    expect(feedbackSignal(0, false)).toBe("ACCEPT");
    expect(feedbackSignal(0.2, false)).toBe("MINOR_EDIT");
    expect(feedbackSignal(0.21, false)).toBe("MAJOR_OVERRIDE");
    expect(feedbackSignal(0, true)).toBe("REJECT");
  });
});

describe("buildActionEvent", () => {
  it("records delta and signal; a rejection is delta 1", () => {
    const e = buildActionEvent({ actor_role: "ADVISOR", action_type: "x", workflow_module: "w", input_context_snapshot: {}, system_proposed_payload: { a: 1 }, human_final_payload: { decision: "rejected" }, rejected: true });
    expect(e.delta_score).toBe(1);
    expect(e.metadata).toMatchObject({ rejected: true, signal: "REJECT" });
  });
  it("has no delta when the AI proposed nothing", () => {
    const e = buildActionEvent({ actor_role: "CLIENT", action_type: "x", workflow_module: "w", input_context_snapshot: {}, human_final_payload: { a: 1 } });
    expect(e.delta_score).toBeNull();
    expect(e.system_proposed_payload).toBeNull();
  });
});
