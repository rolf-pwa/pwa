import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { buildShadowRecord, loadAutonomyConfig, recordShadowTriage } from "../../supabase/functions/_shared/georgia-autonomy";
import { wouldHandle, triageRequest } from "../../supabase/functions/_shared/georgia-triage";
import { CATEGORIES, READY_MIN_RATE, READY_MIN_REVIEWED, readyToGraduate, tally } from "../modules/crm/lib/georgiaAutonomy";

const NOW = new Date("2026-11-05T20:00:00Z");

describe("what she would have done", () => {
  it("is answered or done for a simple request, and Rolf's when gated or unclear", () => {
    expect(wouldHandle(triageRequest("Can I book a meeting with Rolf", "general_inquiry"))).toBe("answered");
    expect(wouldHandle(triageRequest("Please update my phone number", "personal_info"))).toBe("done");
    expect(wouldHandle(triageRequest("I want to withdraw $500", "banking_withdrawal"))).toBe("handed_over");
    expect(wouldHandle(triageRequest("Hello", "general_inquiry"))).toBe("handed_over");
  });
  it("is kept in a record that says what really happened: always handed to Rolf in this stage", () => {
    const rec = buildShadowRecord("Can I book a meeting with Rolf", "general_inquiry", { enabled: true, modes: { meetings: "shadow" } }, NOW);
    expect(rec).toMatchObject({ version: "1", category: "meetings", actual: "handed_over", wouldBe: "answered", decision: { outcome: "handed_over", mode: "shadow", shadow: true }, at: NOW.toISOString() });
  });
  it("records the gate reasons for a request that is Rolf's by rule", () => {
    const rec = buildShadowRecord("I want to change my beneficiary", "personal_info", { enabled: true, modes: { contact_details: "auto" } }, NOW);
    expect(rec).toMatchObject({ category: null, blocked: ["beneficiary"], wouldBe: "handed_over" });
  });
});

function fakeDb(master: boolean, modes: Record<string, string> = {}) {
  const calls: { table: string; op: string; payload?: unknown; where?: unknown }[] = [];
  const db = {
    from(table: string) {
      const q: Record<string, unknown> = {
        select: () => q,
        eq: (_c: string, v: unknown) => { (calls[calls.length - 1] as { where?: unknown } | undefined) && (calls[calls.length - 1].where = v); return q; },
        maybeSingle: async () => ({ data: table === "georgia_autonomy_master" ? { enabled: master } : null }),
        update: (payload: unknown) => { calls.push({ table, op: "update", payload }); return q; },
        insert: async (payload: unknown) => { calls.push({ table, op: "insert", payload }); return { error: null }; },
        then: (res: (v: unknown) => unknown) => res({ data: table === "georgia_autonomy_config" ? Object.entries(modes).map(([category, mode]) => ({ category, mode })) : [], error: null }),
      };
      return q;
    },
  };
  return { db, calls };
}

describe("recording a request", () => {
  it("reads the master switch and the category modes", async () => {
    const { db } = fakeDb(true, { meetings: "shadow", status: "off" });
    expect(await loadAutonomyConfig(db)).toEqual({ enabled: true, modes: { meetings: "shadow", status: "off" } });
  });
  it("does nothing at all while the master switch is off", async () => {
    const { db, calls } = fakeDb(false);
    expect(await recordShadowTriage(db, { requestId: "r1", contactId: "c1", text: "Can I book a meeting", requestType: "general_inquiry" })).toBeNull();
    expect(calls).toEqual([]);
  });
  it("marks the request and writes one audit row that never holds the client's words", async () => {
    const { db, calls } = fakeDb(true, { meetings: "shadow" });
    const text = "Can I book a meeting with Rolf about my account 1819479981";
    const rec = await recordShadowTriage(db, { requestId: "r1", contactId: "c1", text, requestType: "general_inquiry" });
    expect(rec?.category).toBe("meetings");
    const upd = calls.find((c) => c.table === "portal_requests" && c.op === "update")!;
    expect(upd.payload).toMatchObject({ category: "meetings", handled_by: "rolf", outcome: "handed_over" });
    const ins = calls.find((c) => c.table === "georgia_actions" && c.op === "insert")!;
    expect(ins.payload).toMatchObject({ contact_id: "c1", request_id: "r1", category: "meetings", kind: "handed_over", summary: "Shadow: meetings would be answered" });
    expect(JSON.stringify(ins.payload)).not.toContain("1819479981");
    expect(JSON.stringify(ins.payload)).not.toContain("book a meeting");
  });
  it("never throws into the request: a failure leaves it as it was", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const boom = { from: () => { throw new Error("db down"); } };
    expect(await recordShadowTriage(boom, { requestId: "r1", contactId: "c1", text: "x", requestType: "general_inquiry" })).toBeNull();
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
});

describe("the portal chat's request path", () => {
  const src = readFileSync("supabase/functions/portal-assistant/index.ts", "utf8");
  it("records before it makes the task, and still makes the task, closes the request and notifies Rolf as before", () => {
    const rec = src.indexOf("await recordShadowTriage(supabase");
    const task = src.indexOf('from("pm_tasks").insert');
    expect(rec).toBeGreaterThan(0);
    expect(task).toBeGreaterThan(rec);
    expect(src).toContain('status: "resolved"');
    expect(src).toContain('source_type: "new_request"');
  });
});

describe("the review: when a category is ready", () => {
  it("adds the verdicts up by category", () => {
    const t = tally([{ category: "meetings", verdict: "right" }, { category: "meetings", verdict: "right" }, { category: "meetings", verdict: "wrong" }, { category: "meetings", verdict: null }, { category: "none", verdict: "right" }]);
    const m = t.find((x) => x.category === "meetings")!;
    expect(m).toMatchObject({ total: 4, right: 2, wrong: 1, unreviewed: 1 });
    expect(m.rightRate).toBeCloseTo(2 / 3, 5);
    expect(t.find((x) => x.category === "none")!.total).toBe(1);
    expect(t.find((x) => x.category === "status")).toBeUndefined();
  });
  it("is ready at 20 reviewed and 95% right, and not before", () => {
    expect([READY_MIN_REVIEWED, READY_MIN_RATE]).toEqual([20, 0.95]);
    const row = (right: number, wrong: number) => ({ category: "meetings", total: right + wrong, right, wrong, unreviewed: 0, rightRate: right / (right + wrong) });
    expect(readyToGraduate(row(19, 1))).toBe(true);
    expect(readyToGraduate(row(18, 2))).toBe(false);
    expect(readyToGraduate(row(10, 0))).toBe(false);
  });
  it("knows the five categories", () => {
    expect(CATEGORIES).toEqual(["status", "documents", "meetings", "ia_self_serve", "contact_details"]);
  });
});
