// briefing-facts.ts: the pure parts of the morning briefing: what an email is, which calendar events collide, and the lists shown under the
// priorities. Nothing here reads a database or an API, so it can be unit-tested. The model only ranks and words the priorities; everything
// listed below them is built deterministically from the facts.

export type EmailKind = "ia_notice" | "adobe_sign" | "spam" | "promo" | "automated" | "other";
/** `bulk`: the message carries a List-Unsubscribe header (a newsletter or marketing mail). */
export interface EmailLike { from: string; subject: string; snippet?: string; labels?: string[]; to?: string; bulk?: boolean }

const IA_FROM = /(inalco|industrial.?alliance|@ia\.ca|iafinancial|iagto|ia financial|iaa\.secureweb)/i;
const IA_SUBJECT = /(business tracker|new business|requirements? outstanding|outstanding requirement|illustration|contract (issued|status)|pending (case|requirement))/i;
const ADOBE_FROM = /(adobesign|echosign|adobe sign|@adobe\.com)/i;
const AUTOMATED_FROM = /(no-?reply|do-?not-?reply|donotreply|mailer-daemon|notifications?@|catch@|alerts?@|statements?@)/i;
const SPAM_PHRASES = /(guest post|backlinks?|seo services?|crypto|casino|lottery|viagra|you have won|wire transfer|dear beneficiary|click here to claim|rank your website|link building)/i;

export function classifyEmail(m: EmailLike): EmailKind {
  const labels = m.labels ?? [];
  const text = `${m.from} ${m.subject}`;
  if (labels.includes("SPAM")) return "spam";
  if (ADOBE_FROM.test(m.from)) return "adobe_sign";
  // Marketing and newsletters (even from iA) are not notices that need action.
  if (m.bulk && !SPAM_PHRASES.test(text)) return "promo";
  if (IA_FROM.test(m.from) || (IA_SUBJECT.test(m.subject) && /ia|alliance/i.test(m.from))) return "ia_notice";
  if (SPAM_PHRASES.test(`${text} ${m.snippet ?? ""}`)) return "spam";
  if (labels.includes("CATEGORY_PROMOTIONS") || labels.includes("CATEGORY_SOCIAL")) return "promo";
  if (AUTOMATED_FROM.test(m.from)) return "automated";
  return "other";
}

export interface CalEvent { summary: string; start: string; end: string | null; allDay: boolean; link?: string | null }
/** Pairs of timed events that overlap. All-day events never collide with anything. */
export function calendarConflicts(events: CalEvent[]): { a: string; b: string; at: string }[] {
  const timed = events.filter((e) => !e.allDay && e.end).map((e) => ({ ...e, s: Date.parse(e.start), e2: Date.parse(e.end as string) })).filter((e) => Number.isFinite(e.s) && Number.isFinite(e.e2)).sort((x, y) => x.s - y.s);
  const out: { a: string; b: string; at: string }[] = [];
  for (let i = 0; i < timed.length; i++) for (let j = i + 1; j < timed.length; j++) {
    if (timed[j].s >= timed[i].e2) break;
    out.push({ a: timed[i].summary, b: timed[j].summary, at: timed[j].start });
  }
  return out;
}

/** The week ahead: events grouped by Pacific date, soonest first, for the days after `today`. */
export function groupWeek(events: CalEvent[], today: string, toDate: (iso: string) => string): { date: string; items: CalEvent[] }[] {
  const by = new Map<string, CalEvent[]>();
  for (const e of events) {
    const d = e.allDay ? e.start.slice(0, 10) : toDate(e.start);
    if (d <= today) continue;
    by.set(d, [...(by.get(d) ?? []), e]);
  }
  return [...by.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, items]) => ({ date, items: items.sort((x, y) => x.start.localeCompare(y.start)) }));
}

export interface BriefingSections {
  schedule: { start: string; end: string | null; allDay: boolean; summary: string; link: string | null; conflict: boolean }[];
  week: { date: string; items: { start: string; allDay: boolean; summary: string; link: string | null }[] }[];
  replies: { id?: string; key?: string; from: string; subject: string; link: string }[];
  ia: { id?: string; key?: string; kind: "ia_notice" | "adobe_sign"; from: string; subject: string; link: string }[];
  texts: { key?: string; label: string; contact: string | null; link: string }[];
  firm: { key?: string; label: string; link: string }[];
  /** Things that were in the briefing and have since been dealt with. */
  handled?: { label: string; link: string | null }[];
  /** Keys of items Rolf marked done by hand (the Done button), so they stay off the briefing for the rest of the day. */
  dismissed?: string[];
  counts: { spam: number; promo: number; automated: number; adminTotal: number; muted?: number };
}

export const emptySections = (): BriefingSections => ({ schedule: [], week: [], replies: [], ia: [], texts: [], firm: [], counts: { spam: 0, promo: 0, automated: 0, adminTotal: 0 } });

export interface BriefingEmail { id: string; from: string; subject: string; snippet: string; labels: string[]; link: string; bulk?: boolean }
/** Sorts mail into the lists the briefing shows: people to reply to, iA and Adobe Sign items, and counts of what was left out. */
export function sectionsFromEmails(emails: BriefingEmail[], adminCount = 0): Pick<BriefingSections, "replies" | "ia" | "counts"> {
  const out: Pick<BriefingSections, "replies" | "ia" | "counts"> = { replies: [], ia: [], counts: { spam: 0, promo: 0, automated: 0, adminTotal: adminCount } };
  for (const e of emails) {
    const kind = classifyEmail(e);
    if (kind === "spam") out.counts.spam++;
    else if (kind === "promo") out.counts.promo++;
    else if (kind === "automated") out.counts.automated++;
    else if (kind === "ia_notice" || kind === "adobe_sign") out.ia.push({ id: e.id, key: `email:${e.id}`, kind, from: e.from, subject: e.subject, link: e.link });
    else out.replies.push({ id: e.id, key: `email:${e.id}`, from: e.from, subject: e.subject, link: e.link });
  }
  return out;
}
