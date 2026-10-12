import { describe, it, expect } from "vitest";
import { describeEvent } from "@/modules/crm/lib/onboardingAgent";

describe("describeEvent", () => {
  it("describes reminders by next step without listing documents", () => {
    expect(describeEvent({ kind: "nudge_sent", detail: { step: "survey" } })).toBe("Sent a reminder email (next step: book the Survey Session)");
    expect(describeEvent({ kind: "nudge_would_send", detail: { step: "documents" } })).toBe("Would send a reminder email (next step: add documents)");
  });
  it("says why a case was handed to a person", () => {
    expect(describeEvent({ kind: "escalated", detail: { reason: "no_response" } })).toBe("Handed to a person: no response to reminders");
    expect(describeEvent({ kind: "would_escalate", detail: { reason: "vault_failed" } })).toBe("Would hand to a person: the Vault could not be built");
  });
  it("names who changed the mode or paused a case", () => {
    expect(describeEvent({ kind: "mode_changed", detail: { from: "shadow", to: "live", by: "rolf@prosperwise.ca" } })).toBe("Mode changed from shadow to live by rolf@prosperwise.ca");
    expect(describeEvent({ kind: "paused", detail: { by: "rolf@prosperwise.ca" } })).toBe("Paused by rolf@prosperwise.ca");
  });
  it("falls back to a readable label for unknown events", () => {
    expect(describeEvent({ kind: "something_new", detail: {} })).toBe("something new");
  });
});
