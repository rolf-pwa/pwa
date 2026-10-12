import { describe, it, expect } from "vitest";
import { CHECKLIST, newlyDone, progressFrom, parentTitle, NUDGE_COMMENT } from "../../supabase/functions/_shared/onboarding-checklist";

describe("onboarding checklist", () => {
  it("lists the three milestones in order", () => {
    expect(CHECKLIST.map((c) => c.key)).toEqual(["vault", "survey", "documents"]);
    expect(parentTitle("Smith")).toBe("Onboarding: Smith");
  });
  it("derives progress from the case facts", () => {
    expect(progressFrom({ vaultProvisioned: true, surveyBooked: false, docsReceived: true })).toEqual({ vault: true, survey: false, documents: true });
  });
  it("reports only items that just became done", () => {
    const p = progressFrom({ vaultProvisioned: true, surveyBooked: true, docsReceived: false });
    expect(newlyDone(p, [])).toEqual(["vault", "survey"]);
    expect(newlyDone(p, ["vault"])).toEqual(["survey"]);
    expect(newlyDone(p, ["vault", "survey"])).toEqual([]);
  });
  it("describes reminders without saying what is missing", () => {
    expect(NUDGE_COMMENT(2, "documents")).toBe("Georgia sent reminder 2 by email (next step: add documents).");
  });
});
