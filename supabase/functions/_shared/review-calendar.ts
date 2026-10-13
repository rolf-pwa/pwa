// review-calendar.ts: finds a family's booked review meeting on Rolf's calendar. Shared by Georgia's review-window tick and the
// portal's instant booking check. A booking is an event in the window, titled for the meeting, with one of the family's adults.

import { getServiceGoogleAccessToken } from "./google-token.ts";
import { kindFromTitle, type ReviewKind } from "./review-windows.ts";

const DAY = 86_400_000;

// deno-lint-ignore no-explicit-any
export async function findBooking(db: any, emails: string[], kind: ReviewKind, windowStart: string, windowEnd: string, cache: Map<string, any[]> = new Map()): Promise<{ id: string; start: number } | null> {
  if (!emails.length) return null;
  const token = await getServiceGoogleAccessToken(db);
  const timeMin = new Date(Date.parse(`${windowStart}T00:00:00Z`) - 14 * DAY).toISOString();
  const timeMax = new Date(Date.parse(`${windowEnd}T23:59:59Z`) + DAY).toISOString();
  let best: { id: string; start: number } | null = null;
  for (const email of emails) {
    const key = `${email}|${timeMin}|${timeMax}`;
    if (!cache.has(key)) {
      const res = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events?" + new URLSearchParams({ timeMin, timeMax, maxResults: "100", singleEvents: "true", orderBy: "startTime", q: email }), { headers: { Authorization: `Bearer ${token}` } });
      cache.set(key, res.ok ? ((await res.json()).items ?? []) : []);
    }
    for (const ev of cache.get(key) ?? []) {
      if (ev.status === "cancelled" || kindFromTitle(ev.summary) !== kind) continue;
      const withFamily = (ev.attendees ?? []).some((a: any) => String(a.email ?? "").toLowerCase() === email) || String(ev.organizer?.email ?? "").toLowerCase() === email || String(ev.creator?.email ?? "").toLowerCase() === email;
      const startMs = Date.parse(ev.start?.dateTime ?? `${ev.start?.date}T12:00:00Z`);
      if (!withFamily || !Number.isFinite(startMs)) continue;
      if (!best || startMs < best.start || (best.start < Date.now() && startMs >= Date.now())) best = { id: ev.id, start: startMs };
    }
  }
  return best;
}
