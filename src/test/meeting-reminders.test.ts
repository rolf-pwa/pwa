import { describe, it, expect } from "vitest";
import { matchReminderType, remindersDue, inReminderHours, relativeDay, whenLabel, reminderEmail } from "../../supabase/functions/_shared/meeting-reminders";

const types = [
  { label: "Annual Review", client_label: null, reminders: true },
  { label: "Governance Review", client_label: null, reminders: true },
  { label: "Sovereignty Review", client_label: null, reminders: true },
  { label: "Interim Strategy Session", client_label: null, reminders: true, event_title: "Interim Strategy Consultation" },
  { label: "Sovereignty Survey", client_label: null, reminders: false },
];
const DAY = 86_400_000;
const START = Date.parse("2026-11-10T17:00:00Z"); // 10:00 Pacific (B.C. stays on UTC-7 from 2026-11-01)

describe("which meetings get reminders", () => {
  it("matches an event title to a type, ignoring the client's name", () => {
    expect(matchReminderType("Governance Review (Colleen Jerczynski)", types)?.label).toBe("Governance Review");
    expect(matchReminderType("Interim Strategy Session - Sam", types)?.label).toBe("Interim Strategy Session");
    expect(matchReminderType("Interim Strategy Consultation (Sam Fox)", types)?.label).toBe("Interim Strategy Session"); // the title Google uses
  });
  it("recognises the older names", () => {
    expect(matchReminderType("Charter Review (Colleen Jerczynski)", types)?.label).toBe("Governance Review");
    expect(matchReminderType("System Review", types)?.label).toBe("Sovereignty Review");
  });
  it("ignores types without reminders and unrelated events", () => {
    expect(matchReminderType("Sovereignty Survey (Sam)", types)).toBeNull();
    expect(matchReminderType("Lunch with Dave", types)).toBeNull();
    expect(matchReminderType(undefined, types)).toBeNull();
  });
});

describe("when reminders are due", () => {
  it("sends the week-ahead reminder from seven days out, for a meeting booked well before", () => {
    expect(remindersDue(START, START - 30 * DAY, START - 7 * DAY + 3_600_000)).toEqual(["7d"]);
    expect(remindersDue(START, START - 30 * DAY, START - 8 * DAY)).toEqual([]);
  });
  it("still sends it up to a day late, but not after that", () => {
    expect(remindersDue(START, START - 30 * DAY, START - 7 * DAY + 20 * 3_600_000)).toEqual(["7d"]);
    expect(remindersDue(START, START - 30 * DAY, START - 5 * DAY)).toEqual([]);
  });
  it("sends the day-before reminder from 24 hours out until two hours before", () => {
    expect(remindersDue(START, START - 30 * DAY, START - DAY + 3_600_000)).toEqual(["1d"]);
    expect(remindersDue(START, START - 30 * DAY, START - 3 * 3_600_000)).toEqual(["1d"]);
    expect(remindersDue(START, START - 30 * DAY, START - 3_600_000)).toEqual([]);
  });
  it("skips a reminder that is already past when the meeting was booked", () => {
    expect(remindersDue(START, START - 3 * DAY, START - DAY + 3_600_000)).toEqual(["1d"]);
    expect(remindersDue(START, START - 3 * DAY, START - 7 * DAY + 3_600_000)).toEqual([]);
    expect(remindersDue(START, START - 3_600_000, START - 3_600_000 + 60_000)).toEqual([]);
  });
  it("never reminds about a meeting that has started", () => {
    expect(remindersDue(START, null, START + 1)).toEqual([]);
  });
  it("sends only in daytime Pacific hours", () => {
    expect(inReminderHours(Date.parse("2026-11-03T17:00:00Z"))).toBe(true); // 10:00
    expect(inReminderHours(Date.parse("2026-11-03T09:00:00Z"))).toBe(false); // 01:00
  });
});

describe("the reminder email", () => {
  it("says tomorrow or in a week, with the date, time zone and a way to join", () => {
    expect(relativeDay(START, START - DAY + 3_600_000)).toBe("tomorrow");
    expect(relativeDay(START, START - 7 * DAY + 3_600_000)).toBe("in a week");
    expect(relativeDay(START, START - 3_600_000)).toBe("today");
    expect(whenLabel(START)).toMatch(/Tuesday, November 10 at 10:00 (a\.m\.|AM) PT/i);
    const e = reminderEmail({ firstName: "Sam", meetingName: "Governance Review", startMs: START, now: START - DAY + 3_600_000, joinUrl: "https://meet.google.com/abc", portalUrl: "https://app.prosperwise.ca/portal", fromLine: "Georgia, Rolf's AI Assistant" });
    expect(e.subject).toBe("Reminder: your Governance Review is tomorrow");
    expect(e.html).toContain("https://meet.google.com/abc");
    expect(e.html).toContain("Georgia, Rolf's AI Assistant");
    expect(e.html).not.toMatch(/\$|balance/i);
  });
  it("shows a location when there is no video link, and escapes names", () => {
    const e = reminderEmail({ firstName: "<b>x</b>", meetingName: "Annual Review", startMs: START, now: START - 7 * DAY + 3_600_000, location: "Kelowna office", portalUrl: "p", fromLine: "f" });
    expect(e.html).toContain("Where: Kelowna office");
    expect(e.html).not.toContain("<b>x</b>");
    expect(e.subject).toBe("Reminder: your Annual Review is in a week");
  });
});
