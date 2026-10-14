import { describe, it, expect } from "vitest";
import { describeReviewEvent, groupByQuarter, rebalancingStage, statusLabel, type ReviewObligation } from "@/modules/crm/lib/reviewAgent";

describe("describeReviewEvent", () => {
  it("describes invitations and reminders", () => {
    expect(describeReviewEvent({ kind: "invitation_sent", detail: { reminder: false, to: 2 } })).toBe("Sent the invitation to 2 adults");
    expect(describeReviewEvent({ kind: "invitation_would_send", detail: { reminder: true, to: 1 } })).toBe("Would send a reminder to 1 adult");
  });
  it("describes bookings and meetings", () => {
    expect(describeReviewEvent({ kind: "booking_detected", detail: { start: "2027-02-10T18:00:00.000Z" } })).toBe("Meeting found on the calendar for Feb 10");
    expect(describeReviewEvent({ kind: "held", detail: {} })).toBe("The meeting took place");
  });
  it("says why a family was handed to a person", () => {
    expect(describeReviewEvent({ kind: "escalated", detail: { reason: "not_booked_near_end" } })).toBe("Handed to a person: not booked with time running out");
    expect(describeReviewEvent({ kind: "would_escalate", detail: { reason: "window_closed" } })).toBe("Would hand to a person: the window closed with no meeting");
  });
  it("describes replies and mode changes", () => {
    expect(describeReviewEvent({ kind: "reply_snoozed", detail: { waitDays: 14 } })).toBe("Family acknowledged: Georgia will wait 14 days");
    expect(describeReviewEvent({ kind: "mode_changed", detail: { from: "shadow", to: "live", by: "rolf@prosperwise.ca" } })).toBe("Mode changed from shadow to live by rolf@prosperwise.ca");
  });
});

describe("tracking-only windows", () => {
  it("explains a window that was already open at go-live", () => {
    expect(describeReviewEvent({ kind: "obligation_opened", detail: { kind: "governance_review", window: "2026-10-01 to 2026-12-31", trackingOnly: true } })).toContain("watching for a booking, no invitations");
  });
});

describe("reminder mode changes", () => {
  it("describes them in the log", () => {
    expect(describeReviewEvent({ kind: "reminder_mode_changed", detail: { from: "shadow", to: "live", by: "rolf@prosperwise.ca" } })).toBe("Meeting reminders changed from shadow to live by rolf@prosperwise.ca");
  });
});

describe("groupByQuarter", () => {
  const ob = (o: Partial<ReviewObligation>): ReviewObligation => ({
    id: Math.random().toString(), family_id: "f", family_name: "Fox", kind: "annual_review", window_key: "k", window_start: "2027-01-01", window_end: "2027-03-31",
    tier: "tier_1", mode: "live", status: "open", booked_start: null, nudge_count: 0, escalation_reason: null, ...o,
  });
  it("makes a section per quarter in date order, marking the current one", () => {
    const secs = groupByQuarter([
      ob({ window_start: "2027-01-01", window_end: "2027-03-31" }), ob({ window_start: "2026-10-01", window_end: "2026-12-31", kind: "governance_review" }),
      ob({ window_start: "2027-04-01", window_end: "2027-06-30", kind: "sovereignty_review" }),
    ], "2026-11-05");
    expect(secs.map((s) => s.label)).toEqual(["Q4 2026", "Q1 2027", "Q2 2027"]);
    expect(secs.map((s) => s.isCurrent)).toEqual([true, false, false]);
    expect(secs[0].range).toBe("Oct 1 to Dec 31");
    expect(secs.map((s) => s.isPast)).toEqual([false, false, false]);
  });
  it("puts a half-year window in the quarter it ends", () => {
    const secs = groupByQuarter([ob({ window_start: "2027-01-01", window_end: "2027-06-30", kind: "sovereignty_review", window_key: "h1" })], "2027-02-01");
    expect(secs.map((s) => s.label)).toEqual(["Q2 2027"]);
  });
  it("counts each status and sorts what needs attention first", () => {
    const secs = groupByQuarter([
      ob({ family_name: "Zed", status: "booked" }), ob({ family_name: "Abe", status: "open" }), ob({ family_name: "Moe", status: "escalated" }),
      ob({ family_name: "Cal", status: "held" }), ob({ family_name: "Dee", status: "paused" }), ob({ family_name: "Gone", status: "cancelled" }),
    ], "2027-02-01");
    expect(secs).toHaveLength(1);
    expect(secs[0].counts).toEqual({ notBooked: 2, booked: 1, held: 1, withPerson: 1, toExecute: 0 });
    expect(secs[0].items.map((i) => i.family_name)).toEqual(["Moe", "Abe", "Dee", "Zed", "Cal"]);
  });
  it("marks earlier quarters as past", () => {
    const secs = groupByQuarter([ob({ window_start: "2026-07-01", window_end: "2026-09-30" })], "2026-11-05");
    expect(secs[0].isPast).toBe(true);
  });
});

describe("rebalancing in the log and labels", () => {
  it("describes acknowledgements and requests to talk", () => {
    expect(describeReviewEvent({ kind: "rebalancing_acknowledged", detail: { by: "Sam Fox", label: "Q3 2027" } })).toBe("Sam Fox reviewed and acknowledged the Q3 2027 rebalancing");
    expect(describeReviewEvent({ kind: "rebalancing_talk_first", detail: { by: "Sam Fox", label: "Q4 2027" } })).toBe("Sam Fox wants to talk before the Q4 2027 rebalancing");
    expect(describeReviewEvent({ kind: "held", detail: { kind: "rebalancing" } })).toBe("The client acknowledged the rebalancing");
    expect(describeReviewEvent({ kind: "held", detail: {} })).toBe("The meeting took place");
  });
});

describe("rebalancing stages", () => {
  const o = (x: any) => ({ published_at: null, acknowledged_at: null, completed_at: null, ...x });
  it("moves from preparing to waiting for the client to to-carry-out to done", () => {
    expect(rebalancingStage(o({}))).toBe("preparing");
    expect(rebalancingStage(o({ published_at: "2027-08-02T00:00:00Z" }))).toBe("waiting");
    expect(rebalancingStage(o({ published_at: "x", acknowledged_at: "y" }))).toBe("toExecute");
    expect(rebalancingStage(o({ published_at: "x", acknowledged_at: "y", completed_at: "z" }))).toBe("done");
  });
  it("labels each stage for Rolf, and leaves a meeting's label alone", () => {
    expect(statusLabel({ ...o({}), status: "open", kind: "rebalancing" })).toBe("Preparing");
    expect(statusLabel({ ...o({ published_at: "x" }), status: "open", kind: "rebalancing" })).toBe("Waiting for the client");
    expect(statusLabel({ ...o({ published_at: "x", acknowledged_at: "y" }), status: "held", kind: "rebalancing" })).toBe("To carry out");
    expect(statusLabel({ ...o({ published_at: "x", acknowledged_at: "y", completed_at: "z" }), status: "held", kind: "rebalancing" })).toBe("Done");
    expect(statusLabel({ ...o({}), status: "held", kind: "annual_review" })).toBe("Held");
    expect(statusLabel({ ...o({}), status: "escalated", kind: "rebalancing" })).toBe("With a person");
  });
  it("counts rebalancing stages in the quarter header", () => {
    const base: any = { id: "1", family_id: "f", family_name: "Fox", kind: "rebalancing", window_key: "w", window_start: "2027-07-01", window_end: "2027-09-30", tier: "tier_1", mode: "live", status: "open", booked_start: null, nudge_count: 0, escalation_reason: null };
    const secs = groupByQuarter([
      { ...base, id: "a" }, { ...base, id: "b", published_at: "x" },
      { ...base, id: "c", status: "held", published_at: "x", acknowledged_at: "y" }, { ...base, id: "d", status: "held", published_at: "x", acknowledged_at: "y", completed_at: "z" },
    ], "2027-08-01");
    expect(secs[0].counts).toEqual({ notBooked: 2, booked: 0, held: 1, withPerson: 0, toExecute: 1 });
  });
  it("describes publishing, taking back and completing", () => {
    expect(describeReviewEvent({ kind: "rebalancing_published", detail: {} })).toContain("Georgia will invite the family to review it");
    expect(describeReviewEvent({ kind: "rebalancing_completed", detail: {} })).toContain("the family was told");
  });
});

describe("status label", () => {
  it("calls a completed rebalancing Acknowledged, and a held meeting Held", () => {
    expect(statusLabel({ status: "held", kind: "annual_review", published_at: null, acknowledged_at: null, completed_at: null })).toBe("Held");
  });
});
