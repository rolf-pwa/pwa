// meeting-event.ts: finding which calendar event a follow-up task came from, and naming its attendees. Pure.

export interface CalEventLite { id: string; summary: string; start: string; end: string; allDay: boolean; attendees: { email: string; displayName?: string | null; self?: boolean }[] }

export interface MatchOptions {
  /** Emails of the household's contacts, lower case. */
  clientEmails: Set<string>;
  /** Names that would appear in a meeting title: full names and surnames. */
  clientNames: string[];
  /** When the follow-up task was opened. */
  anchor: string;
}

const HOUR = 3_600_000;

/**
 * The calendar event most likely to be the meeting: invitees who are the household's contacts, the client's name in the title,
 * and being close to (and before) the moment the follow-up was opened. Returns null when nothing shows the client was involved.
 */
export function pickEvent(events: CalEventLite[], o: MatchOptions): CalEventLite | null {
  const anchor = Date.parse(o.anchor);
  let best: { e: CalEventLite; score: number } | null = null;
  for (const e of events) {
    if (e.allDay) continue;
    const matches = e.attendees.filter((a) => o.clientEmails.has(a.email.toLowerCase())).length;
    const title = e.summary.toLowerCase();
    const named = o.clientNames.some((n) => n.trim().length > 2 && title.includes(n.trim().toLowerCase()));
    const evidence = Math.min(matches, 2) * 5 + (named ? 4 : 0);
    if (evidence < 4) continue;
    const gapH = (anchor - Date.parse(e.end)) / HOUR; // positive: the event ended before the task was opened
    const timing = gapH >= -2 ? Math.max(0, 6 - gapH / 24) : -10 + gapH / 24; // events well after the task are unlikely
    const score = evidence + timing;
    if (!best || score > best.score) best = { e, score };
  }
  return best?.e ?? null;
}

export interface Known { staffDomain: string; contacts: { email: string | null; name: string; role?: string | null }[]; pros: { email: string | null; name: string; type?: string | null }[] }

/** Names and roles for an event's invitees: staff, the household's contacts, professionals; anyone else by their own name or address. */
export function namedAttendees(attendees: CalEventLite["attendees"], k: Known): { name: string; role: string }[] {
  const out: { name: string; role: string }[] = [];
  const seen = new Set<string>();
  for (const a of attendees) {
    const email = (a.email || "").toLowerCase();
    if (!email || seen.has(email)) continue;
    seen.add(email);
    const contact = k.contacts.find((c) => c.email?.toLowerCase() === email);
    const pro = k.pros.find((p) => p.email?.toLowerCase() === email);
    if (email.endsWith(`@${k.staffDomain}`) || a.self) out.push({ name: a.displayName || "Rolf Issler", role: "Advisor" });
    else if (contact) out.push({ name: contact.name, role: "Client" });
    else if (pro) out.push({ name: pro.name, role: `Professional${pro.type ? `, ${pro.type.replace(/_/g, " ")}` : ""}` });
    else out.push({ name: a.displayName || email, role: "Guest" });
  }
  return out;
}

/** The household's own email addresses, lower case, without the firm's: the advisor is on every event, so his address shows nothing about who the meeting was with. */
export function clientEmailSet(members: { email?: string | null }[], staffDomain: string): Set<string> {
  return new Set(members.map((m) => String(m.email ?? "").trim().toLowerCase()).filter((e) => e && !e.endsWith(`@${staffDomain}`)));
}
