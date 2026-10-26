import { describe, expect, it } from "vitest";
import { BC_PERMANENT_FROM, pacificOffsetHours } from "../../supabase/functions/_shared/bc-time";
import { inReminderHours, relativeDay, whenLabel } from "../../supabase/functions/_shared/meeting-reminders";
import { parseNotesName } from "../../supabase/functions/_shared/meeting-notes";

const hm = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Vancouver", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(iso));

describe("B.C. stays on UTC-7 from 2026-11-01", () => {
  it("does not turn the clocks back: 17:00 UTC is 10:00 in November and all winter, not 9:00", () => {
    expect(hm("2026-10-30T17:00:00Z")).toBe("10:00 a.m. PDT");
    expect(hm("2026-11-02T17:00:00Z")).toBe("10:00 a.m. PT");
    expect(hm("2027-01-15T17:00:00Z")).toBe("10:00 a.m. PT");
    expect(hm("2027-07-15T17:00:00Z")).toBe("10:00 a.m. PT");
  });
  it("leaves earlier winters as they were (PST, UTC-8)", () => {
    expect(hm("2025-12-15T17:00:00Z")).toBe("9:00 a.m. PST");
    expect(hm("2026-01-15T17:00:00Z")).toBe("9:00 a.m. PST");
  });
  it("changes at the moment the clocks would have gone back, 02:00 PDT on 2026-11-01", () => {
    expect(BC_PERMANENT_FROM).toBe(Date.UTC(2026, 10, 1, 9, 0));
    expect(hm("2026-11-01T08:59:00Z")).toBe("1:59 a.m. PDT");
    expect(hm("2026-11-01T09:00:00Z")).toBe("2:00 a.m. PT");
  });
  it("applies to toLocaleString and friends, and to other zones not at all", () => {
    expect(new Date("2026-11-02T17:00:00Z").toLocaleTimeString("en-CA", { timeZone: "America/Vancouver", hour: "numeric", minute: "2-digit" })).toBe("10:00 a.m.");
    expect(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", hour: "numeric", timeZoneName: "short" }).format(new Date("2026-12-02T17:00:00Z"))).toBe("9 a.m. PST");
  });
  it("gives the offset the manual date arithmetic needs", () => {
    expect([pacificOffsetHours(Date.parse("2026-10-30T17:00:00Z")), pacificOffsetHours(Date.parse("2026-11-02T17:00:00Z")), pacificOffsetHours(Date.parse("2026-01-15T17:00:00Z"))]).toEqual([-7, -7, -8]);
  });
  it("shows a meeting reminder for a November meeting at the time the calendar shows", () => {
    const start = Date.parse("2026-11-02T17:00:00Z"); // 10:00 on Monday, November 2 in B.C.
    expect(whenLabel(start)).toBe("Monday, November 2 at 10:00 a.m. PT");
    expect(relativeDay(start, Date.parse("2026-11-01T17:00:00Z"))).toBe("tomorrow");
    expect(inReminderHours(Date.parse("2026-11-02T03:00:00Z"))).toBe(false); // 8 pm Sunday is the last hour; 3:00 UTC is 20:00 PT
    expect(inReminderHours(Date.parse("2026-11-02T15:00:00Z"))).toBe(true); // 8:00 PT
  });
  it("reads a Gemini notes name stamped PT as UTC-7", () => {
    expect(parseNotesName("Charter Review (Sam) - 2026/11/03 10:00 PT - Notes by Gemini")?.startIso).toBe("2026-11-03T17:00:00.000Z");
    expect(parseNotesName("Review - 2026/10/13 12:00 PDT - Notes by Gemini")?.startIso).toBe("2026-10-13T19:00:00.000Z");
    expect(parseNotesName("Review - 2026/01/13 12:00 PST - Notes by Gemini")?.startIso).toBe("2026-01-13T20:00:00.000Z");
  });
});
