import { describe, expect, it } from "vitest";
import { STAFF_MEETING_TYPES } from "@/shared/lib/staffMeetingTypes";
import { MEETING_BOOKING_LINKS } from "@/shared/lib/meetingBookingLinks";

describe("staff meeting types", () => {
  it("has the eight booking-page types, each with a schedule URL and an embeddable URL", () => {
    expect(STAFF_MEETING_TYPES).toHaveLength(8);
    for (const m of STAFF_MEETING_TYPES) {
      expect(m.url).toMatch(/^https:\/\/calendar\.google\.com\/calendar\/appointments\/schedules\/[\w-]+$/);
      expect(m.embedUrl).toBe(`${m.url}?gv=true`);
      expect(m.minutes).toBeGreaterThan(0);
    }
    expect(new Set(STAFF_MEETING_TYPES.map((m) => m.url)).size).toBe(8);
  });
  it("keeps staff-only and prospect meetings out of the client portal's list", () => {
    const clientLabels = MEETING_BOOKING_LINKS.map((l) => l.label.toLowerCase()).join(" ");
    for (const staffOnly of ["clarity call", "networking", "sovereignty survey"]) expect(clientLabels).not.toContain(staffOnly);
  });
});
