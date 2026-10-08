// Splits a contact's calendar events into upcoming and previous meetings. Pure.

export interface CalEvent {
  id: string;
  summary?: string;
  htmlLink?: string;
  start?: { dateTime?: string; date?: string };
  attendees?: { email?: string }[];
  organizer?: { email?: string };
  creator?: { email?: string };
  status?: string;
}

/** Events the contact is part of (attendee, organizer or creator); cancelled events are dropped. */
export function eventsWithContact(items: CalEvent[], email: string): CalEvent[] {
  const e = email.toLowerCase();
  return items.filter((ev) =>
    ev.status !== "cancelled" &&
    ((ev.attendees ?? []).some((a) => a.email?.toLowerCase() === e) || ev.organizer?.email?.toLowerCase() === e || ev.creator?.email?.toLowerCase() === e));
}

const startOf = (ev: CalEvent): number => {
  if (ev.start?.dateTime) { const t = Date.parse(ev.start.dateTime); return Number.isFinite(t) ? t : NaN; }
  const m = ev.start?.date?.match(/^(\d{4})-(\d{2})-(\d{2})$/); // an all-day event is a local date, not a UTC instant
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime() : NaN;
};

/** Upcoming soonest first; previous most recent first. An all-day event today still counts as upcoming. */
export function splitMeetings(events: CalEvent[], now: Date = new Date()): { upcoming: CalEvent[]; previous: CalEvent[] } {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const dated = events.filter((e) => !Number.isNaN(startOf(e)));
  const isUpcoming = (e: CalEvent) => (e.start?.dateTime ? startOf(e) >= now.getTime() : startOf(e) >= startOfToday);
  return {
    upcoming: dated.filter(isUpcoming).sort((a, b) => startOf(a) - startOf(b)),
    previous: dated.filter((e) => !isUpcoming(e)).sort((a, b) => startOf(b) - startOf(a)),
  };
}
