import { describe, it, expect } from "vitest";
import { requiredMeetings, kindFromTitle, decideReview, inviteesOf, windowEmail, daysBetween, pacificDate, meetingsOwedNow, gateMeetingTypes, DEFAULT_REVIEW_CONFIG, type ReviewFacts } from "../../supabase/functions/_shared/review-windows";

describe("which meetings each tier is owed", () => {
  it("gives Tier 0 nothing, Tier 1 and 2A one Annual Review in Q1", () => {
    expect(requiredMeetings("tier_0", 2027)).toEqual([]);
    expect(requiredMeetings(null, 2027)).toEqual([]);
    for (const t of ["tier_1", "tier_2a"] as const) {
      expect(requiredMeetings(t, 2027)).toEqual([{ kind: "annual_review", key: "2027-Q1-annual_review", windowStart: "2027-01-01", windowEnd: "2027-03-31" }]);
    }
  });
  it("gives Tier 2B two Sovereignty Reviews, one per half-year", () => {
    expect(requiredMeetings("tier_2b", 2027).map((m) => [m.kind, m.windowStart, m.windowEnd])).toEqual([
      ["sovereignty_review", "2027-01-01", "2027-06-30"], ["sovereignty_review", "2027-07-01", "2027-12-31"],
    ]);
  });
  it("gives Tier 3 (and 4) three Sovereignty Reviews and a Q4 Governance Review", () => {
    for (const t of ["tier_3", "tier_4"] as const) {
      expect(requiredMeetings(t, 2027).map((m) => [m.kind, m.windowStart])).toEqual([
        ["sovereignty_review", "2027-01-01"], ["sovereignty_review", "2027-04-01"], ["sovereignty_review", "2027-07-01"], ["governance_review", "2027-10-01"],
      ]);
    }
  });
  it("has unique keys per tier and year", () => {
    const keys = requiredMeetings("tier_3", 2027).map((m) => m.key);
    expect(new Set(keys).size).toBe(4);
  });
});

describe("recognising a review on the calendar", () => {
  it("matches by the meeting's name, including the older System Review", () => {
    expect(kindFromTitle("Annual Review: Smith")).toBe("annual_review");
    expect(kindFromTitle("Sovereignty Review - Fox family")).toBe("sovereignty_review");
    expect(kindFromTitle("System Review")).toBe("sovereignty_review");
    expect(kindFromTitle("Q4 Governance Review")).toBe("governance_review");
    expect(kindFromTitle("Charter Review (Colleen Jerczynski)")).toBe("governance_review");
    expect(kindFromTitle("Lunch")).toBeNull();
    expect(kindFromTitle(undefined)).toBeNull();
  });
});

describe("what Georgia does for a window", () => {
  // 2027-01-05 is a Tuesday. 18:00 UTC = 10:00 Pacific.
  const TUE_10AM = Date.parse("2027-01-05T18:00:00Z");
  const base = (o: Partial<ReviewFacts> = {}): ReviewFacts => ({
    now: TUE_10AM, status: "open", windowStart: "2027-01-01", windowEnd: "2027-03-31", bookedStart: null, recipients: 2, nudgeCount: 0, lastNudgeAt: null, snoozedUntil: null, ...o,
  });
  it("waits until the window opens, then invites on the first working day", () => {
    expect(decideReview(base({ windowStart: "2027-04-01", windowEnd: "2027-06-30" }))).toEqual({ kind: "wait", reason: "window_not_open" });
    expect(decideReview(base())).toEqual({ kind: "nudge", reminder: false });
  });
  it("sends nothing at night or on weekends", () => {
    expect(decideReview(base({ now: Date.parse("2027-01-05T07:00:00Z") }))).toEqual({ kind: "wait", reason: "outside_send_window" });
    expect(decideReview(base({ now: Date.parse("2027-01-02T18:00:00Z") }))).toEqual({ kind: "wait", reason: "outside_send_window" });
  });
  it("reminds every three weeks, no sooner", () => {
    expect(decideReview(base({ nudgeCount: 1, lastNudgeAt: TUE_10AM - 10 * 86_400_000 }))).toEqual({ kind: "wait", reason: "not_due" });
    expect(decideReview(base({ nudgeCount: 1, lastNudgeAt: TUE_10AM - 22 * 86_400_000 }))).toEqual({ kind: "nudge", reminder: true });
  });
  it("stays quiet once a meeting is booked, and marks it held after it happens", () => {
    expect(decideReview(base({ bookedStart: TUE_10AM + 5 * 86_400_000 }))).toEqual({ kind: "booked" });
    expect(decideReview(base({ bookedStart: TUE_10AM - 86_400_000 }))).toEqual({ kind: "held" });
  });
  it("hands the family to a person with three weeks left and nothing booked", () => {
    const d = decideReview(base({ now: Date.parse("2027-03-12T18:00:00Z"), nudgeCount: 2, lastNudgeAt: Date.parse("2027-02-20T18:00:00Z") }));
    expect(d.kind === "escalate" && d.reason).toBe("not_booked_near_end");
  });
  it("hands over a closed window, and a family nobody can email", () => {
    const closed = decideReview(base({ now: Date.parse("2027-04-02T18:00:00Z") }));
    expect(closed.kind === "escalate" && closed.reason).toBe("window_closed");
    const none = decideReview(base({ recipients: 0 }));
    expect(none.kind === "escalate" && none.reason).toBe("no_email");
  });
  it("leaves paused, escalated and finished work alone, and honours a snooze", () => {
    for (const status of ["paused", "escalated", "held", "cancelled"] as const) expect(decideReview(base({ status })).kind).toBe("wait");
    expect(decideReview(base({ snoozedUntil: TUE_10AM + 86_400_000 }))).toEqual({ kind: "wait", reason: "snoozed" });
  });
  it("stops after the invitation limit", () => {
    const d = decideReview(base({ now: Date.parse("2027-02-01T18:00:00Z"), nudgeCount: 4, lastNudgeAt: Date.parse("2027-01-10T18:00:00Z") }));
    expect(d.kind === "escalate" && d.reason).toBe("no_response");
  });
  it("uses the configured reminder gap", () => {
    expect(decideReview(base({ nudgeCount: 1, lastNudgeAt: TUE_10AM - 8 * 86_400_000 }), { ...DEFAULT_REVIEW_CONFIG, remindEveryDays: 7 })).toEqual({ kind: "nudge", reminder: true });
  });
});

describe("dates and invitees", () => {
  it("computes pacific dates and day gaps", () => {
    expect(pacificDate(Date.parse("2027-01-01T03:00:00Z"))).toBe("2026-12-31");
    expect(daysBetween("2027-03-10", "2027-03-31")).toBe(21);
  });
  it("invites both adults once each, never minors or people without email", () => {
    const c = (o: any) => ({ id: "x", firstName: "A", lastName: "B", email: "a@x.com", role: "head_of_family", isMinor: false, ...o });
    const out = inviteesOf([c({ id: "1" }), c({ id: "2", firstName: "Bo", email: "BO@x.com", role: "spouse" }), c({ id: "3", role: "beneficiary", email: "kid@x.com" }), c({ id: "4", isMinor: true, email: "m@x.com" }), c({ id: "5", email: " " }), c({ id: "6", email: "a@x.com" })]);
    expect(out.map((o) => o.contactId)).toEqual(["1", "2"]);
  });
  it("writes a plain invitation and a reminder, naming only the meeting and the date", () => {
    const e = windowEmail({ firstName: "Sam", kind: "sovereignty_review", windowEnd: "2027-03-31", reminder: false, portalUrl: "https://app.prosperwise.ca/portal", fromLine: "Georgia, Rolf's AI Assistant" });
    expect(e.subject).toBe("Time to book your Sovereignty Review");
    expect(e.html).toContain("before March 31, 2027");
    expect(e.html).toContain("open <strong>Meetings</strong>");
    expect(e.html).not.toMatch(/\$|balance|account/i);
    expect(windowEmail({ firstName: "Sam", kind: "annual_review", windowEnd: "2027-03-31", reminder: true, portalUrl: "x", fromLine: "x" }).subject).toBe("Reminder: book your Annual Review");
  });
});

describe("which meeting links a family sees", () => {
  const NOW = Date.parse("2027-02-10T18:00:00Z");
  const types = [
    { label: "Interim Strategy Session", cadence_kind: null as string | null },
    { label: "Annual Review", cadence_kind: "annual_review" },
    { label: "Sovereignty Review", cadence_kind: "sovereignty_review" },
    { label: "Governance Review", cadence_kind: "governance_review" },
  ];
  it("shows a Tier 1 family only the Annual Review, and only in Q1", () => {
    const owedQ1 = meetingsOwedNow("tier_1", "2027-02-10", [], NOW);
    expect(owedQ1.map((o) => o.kind)).toEqual(["annual_review"]);
    expect(gateMeetingTypes(types, owedQ1, true).bookable.map((t) => t.label)).toEqual(["Interim Strategy Session", "Annual Review"]);
    const owedJune = meetingsOwedNow("tier_1", "2027-06-10", [], NOW);
    expect(gateMeetingTypes(types, owedJune, true).bookable.map((t) => t.label)).toEqual(["Interim Strategy Session"]);
  });
  it("shows Tier 3 the Sovereignty Review in Q1-Q3 and the Governance Review in Q4", () => {
    expect(gateMeetingTypes(types, meetingsOwedNow("tier_3", "2027-05-01", [], NOW), true).bookable.map((t) => t.label)).toEqual(["Interim Strategy Session", "Sovereignty Review"]);
    expect(gateMeetingTypes(types, meetingsOwedNow("tier_3", "2026-11-05", [], NOW), true).bookable.map((t) => t.label)).toEqual(["Interim Strategy Session", "Governance Review"]);
  });
  it("shows a booked message instead of the link, and nothing once the meeting has happened", () => {
    const booked = [{ window_key: "2027-Q1-annual_review", status: "booked", booked_start: "2027-02-20T18:00:00Z" }];
    const g = gateMeetingTypes(types, meetingsOwedNow("tier_1", "2027-02-10", booked, NOW), true);
    expect(g.bookable.map((t) => t.label)).toEqual(["Interim Strategy Session"]);
    expect(g.booked.map((b) => [b.type.label, b.start])).toEqual([["Annual Review", "2027-02-20T18:00:00Z"]]);
    const held = [{ window_key: "2027-Q1-annual_review", status: "held", booked_start: "2027-02-05T18:00:00Z" }];
    const g2 = gateMeetingTypes(types, meetingsOwedNow("tier_1", "2027-02-10", held, NOW), true);
    expect(g2.booked).toEqual([]);
    expect(g2.bookable.map((t) => t.label)).toEqual(["Interim Strategy Session"]);
  });
  it("shows review links only to adults, and nothing to a Tier 0 family", () => {
    expect(gateMeetingTypes(types, meetingsOwedNow("tier_1", "2027-02-10", [], NOW), false).bookable.map((t) => t.label)).toEqual(["Interim Strategy Session"]);
    expect(meetingsOwedNow("tier_0", "2027-02-10", [], NOW)).toEqual([]);
  });
  it("only tracks, never invites, a window that was already open at go-live", () => {
    const f = { now: Date.parse("2026-11-05T18:00:00Z"), status: "open" as const, windowStart: "2026-10-01", windowEnd: "2026-12-31", bookedStart: null, recipients: 1, nudgeCount: 0, lastNudgeAt: null, snoozedUntil: null, invite: false };
    expect(decideReview(f)).toEqual({ kind: "wait", reason: "tracking_only" });
    expect(decideReview({ ...f, bookedStart: Date.parse("2026-11-20T18:00:00Z") })).toEqual({ kind: "booked" });
    expect(decideReview({ ...f, now: Date.parse("2026-12-20T18:00:00Z") })).toEqual({ kind: "wait", reason: "tracking_only" });
  });
});
