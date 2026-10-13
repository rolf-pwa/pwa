import type { BookedMeeting } from "@/modules/portal/components/PortalBookedMeetings";

/**
 * The calendar list for the Meetings page plus any meeting the system knows is booked but the calendar list does not show yet
 * (a booking made a moment ago). A booked meeting that is already in the calendar list, at the same time, is not added twice.
 */
export function withBookedMeetings<T extends { start?: { dateTime?: string; date?: string } }>(meetings: T[], booked: BookedMeeting[] | undefined | null): (T | { summary: string; start: { dateTime: string }; end?: undefined; status: string })[] {
  const out: (T | { summary: string; start: { dateTime: string }; end?: undefined; status: string })[] = [...meetings];
  for (const b of booked ?? []) {
    const t = Date.parse(b.start);
    if (!Number.isFinite(t)) continue;
    const already = meetings.some((m) => m.start?.dateTime && Math.abs(Date.parse(m.start.dateTime) - t) < 120_000);
    if (!already) out.push({ summary: b.label, start: { dateTime: b.start }, status: "confirmed" });
  }
  return out;
}
