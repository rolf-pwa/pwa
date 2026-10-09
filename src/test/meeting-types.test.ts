import { describe, expect, it } from "vitest";
import { forClients, forStaff, moveType, parseBookingLink, type MeetingType } from "@/shared/lib/meetingTypes";

const t = (o: Partial<MeetingType>): MeetingType => ({ id: "a", label: "A", client_label: null, minutes: 60, note: null, url: "u", embed_url: null, sort_order: 0, active: true, staff_visible: true, client_visible: false, ...o });

describe("booking links", () => {
  it("accepts a schedule page link in any of its forms and builds the embeddable URL", () => {
    const want = { url: "https://calendar.google.com/calendar/appointments/schedules/AcZss-1_x", embed_url: "https://calendar.google.com/calendar/appointments/schedules/AcZss-1_x?gv=true" };
    expect(parseBookingLink("https://calendar.google.com/calendar/appointments/schedules/AcZss-1_x")).toEqual(want);
    expect(parseBookingLink("  https://calendar.google.com/calendar/u/0/appointments/schedules/AcZss-1_x?gv=true ")).toEqual(want);
  });
  it("accepts a short link but cannot embed it, and refuses anything else", () => {
    expect(parseBookingLink("https://calendar.app.google/abc123")).toEqual({ url: "https://calendar.app.google/abc123", embed_url: null });
    expect(parseBookingLink("https://example.com/book")).toBeNull();
    expect(parseBookingLink("")).toBeNull();
  });
});

describe("who sees which meeting types", () => {
  const all = [t({ id: "1", label: "Quarterly Review", client_label: "Quarterly Review (In Person)", client_visible: true, sort_order: 1 }), t({ id: "2", label: "Networking", sort_order: 0 }), t({ id: "3", label: "Old", active: false, client_visible: true, sort_order: 2 }), t({ id: "4", label: "Video", staff_visible: false, client_visible: true, sort_order: 3, embed_url: "e" })];
  it("gives staff the active staff-visible types in order", () => expect(forStaff(all).map((x) => x.label)).toEqual(["Networking", "Quarterly Review"]));
  it("gives clients only active client-visible types, under the client name", () => {
    expect(forClients(all).map((x) => x.label)).toEqual(["Quarterly Review (In Person)", "Video"]);
    expect(forClients(all)[1].embedUrl).toBe("e");
  });
});

describe("ordering", () => {
  const list = [t({ id: "a", sort_order: 0 }), t({ id: "b", sort_order: 1 }), t({ id: "c", sort_order: 2 })];
  it("moves a type up or down and renumbers, and stops at the ends", () => {
    expect(moveType(list, "c", -1).map((x) => x.id)).toEqual(["a", "c", "b"]);
    expect(moveType(list, "a", -1).map((x) => x.id)).toEqual(["a", "b", "c"]);
    expect(moveType(list, "b", 1).map((x) => `${x.id}${x.sort_order}`)).toEqual(["a0", "c1", "b2"]);
  });
});
