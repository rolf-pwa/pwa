import { describe, it, expect } from "vitest";
import { describeReviewEvent } from "@/modules/crm/lib/reviewAgent";

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
