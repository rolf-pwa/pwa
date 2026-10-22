import { describe, expect, it } from "vitest";
import { CHECKLIST, checklistFor } from "../../supabase/functions/_shared/insurance-file-rules";
import { ITEM_STAGE, activity, roadmap } from "@/shared/lib/insuranceRoadmap";

const req = (done: string[] = []) => checklistFor("new_sale").map((c) => ({ kind: c.kind, label: c.label, hint: c.hint, done: done.includes(c.kind) }));

describe("insurance compliance roadmap", () => {
  it("places every checklist item in a stage", () => { for (const c of CHECKLIST.filter((x) => x.requiredFor.length)) expect(ITEM_STAGE[c.kind], c.kind).toBeTruthy(); });
  it("puts the Discovery items up next from the first day, and the rest later", () => {
    const r = roadmap(req(), "new_lead");
    expect(r.upNext.map((c) => c.kind)).toEqual(["advisor_disclosure", "privacy_consent", "fact_find", "meeting_records"]);
    expect(r.later.map((c) => c.kind)).toEqual(["needs_analysis", "alternatives", "recommendation", "illustration", "application", "delivery_confirmation"]);
    expect(r.percent).toBe(0);
  });
  it("moves items up next as the stage advances, and counts what is done", () => {
    const r = roadmap(req(["advisor_disclosure", "privacy_consent", "fact_find", "meeting_records"]), "needs_analysis");
    expect(r.upNext.map((c) => c.kind)).toEqual(["needs_analysis"]);
    expect(r.completed).toHaveLength(4);
    expect(r.done).toBe(4);
    expect(r.percent).toBe(40);
  });
  it("is 100% with nothing left", () => {
    const r = roadmap(req(CHECKLIST.map((c) => c.kind)), "coverage_agreed");
    expect(r.upNext).toEqual([]);
    expect(r.later).toEqual([]);
    expect(r.percent).toBe(100);
  });
  it("lists activity newest first and words not-applicable items", () => {
    const ev = activity([{ id: "f", title: "Colleen, term 20", opened_at: "2026-10-20T10:00:00Z", packaged_at: null, items: [{ kind: "fact_find", status: "provided", drive_name: "KYC.pdf", added_by: "x", added_at: "2026-10-21T10:00:00Z" }, { kind: "illustration", status: "not_applicable", drive_name: null, added_by: "x", added_at: "2026-10-22T10:00:00Z" }] }], (k) => k);
    expect(ev.map((e) => e.text)).toEqual(["Marked illustration not applicable", "Added fact_find (KYC.pdf)", "Opened the file Colleen, term 20"]);
  });
});
