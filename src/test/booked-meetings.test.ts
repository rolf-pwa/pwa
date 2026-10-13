import { describe, it, expect } from "vitest";
import { withBookedMeetings } from "@/modules/portal/lib/bookedMeetings";

describe("withBookedMeetings", () => {
  const cal = [{ summary: "Annual Review (Sam)", start: { dateTime: "2027-02-10T18:00:00-08:00" } }];
  it("adds a booked meeting the calendar list does not show yet", () => {
    const out = withBookedMeetings(cal, [{ label: "Governance Review", start: "2026-10-16T18:00:00+00:00" }]);
    expect(out).toHaveLength(2);
    expect(out[1]).toMatchObject({ summary: "Governance Review", start: { dateTime: "2026-10-16T18:00:00+00:00" } });
  });
  it("does not duplicate a meeting that is already listed at the same time", () => {
    expect(withBookedMeetings(cal, [{ label: "Annual Review", start: "2027-02-11T02:00:00+00:00" }])).toHaveLength(1);
  });
  it("copes with nothing booked or a bad date", () => {
    expect(withBookedMeetings(cal, undefined)).toHaveLength(1);
    expect(withBookedMeetings(cal, [{ label: "X", start: "nope" }])).toHaveLength(1);
  });
});
