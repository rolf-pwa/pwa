import { describe, expect, it } from "vitest";
import { eventsWithContact, splitMeetings, type CalEvent } from "@/modules/crm/lib/meetings";

const ev = (id: string, start: string, extra: Partial<CalEvent> = {}): CalEvent => ({ id, start: { dateTime: start }, attendees: [{ email: "Colleen@x.ca" }], ...extra });
const now = new Date("2026-10-10T12:00:00");

describe("meetings with a contact", () => {
  it("keeps events the contact is part of and drops cancelled ones", () => {
    const items = [ev("a", "2026-10-13T13:30:00"), ev("b", "2026-10-14T10:00:00", { attendees: [{ email: "other@x.ca" }] }), ev("c", "2026-10-15T10:00:00", { status: "cancelled" }), ev("d", "2026-09-01T10:00:00", { attendees: [], organizer: { email: "colleen@x.ca" } })];
    expect(eventsWithContact(items, "colleen@x.ca").map((e) => e.id)).toEqual(["a", "d"]);
  });
  it("puts upcoming soonest first and previous most recent first", () => {
    const { upcoming, previous } = splitMeetings([ev("late", "2026-12-01T10:00:00"), ev("soon", "2026-10-13T10:00:00"), ev("old", "2026-03-01T10:00:00"), ev("recent", "2026-09-20T10:00:00")], now);
    expect(upcoming.map((e) => e.id)).toEqual(["soon", "late"]);
    expect(previous.map((e) => e.id)).toEqual(["recent", "old"]);
  });
  it("treats an all-day event today as upcoming and skips undated events", () => {
    const { upcoming, previous } = splitMeetings([{ id: "today", start: { date: "2026-10-10" } }, { id: "nodate" }, { id: "yday", start: { date: "2026-10-09" } }], now);
    expect(upcoming.map((e) => e.id)).toEqual(["today"]);
    expect(previous.map((e) => e.id)).toEqual(["yday"]);
  });
});
