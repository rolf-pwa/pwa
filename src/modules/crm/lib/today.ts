// today.ts: what the Today buttons show. Pure apart from the small "seen" store: the lists behind the buttons, which of their items are new, and what is remembered about
// what has been seen. Items open the contact they concern when there is one.
import type { BriefingSections } from "../../../../supabase/functions/_shared/briefing-facts";
import { clock, dayLabel } from "./briefing";

export type TileId = "messages" | "requests" | "firm" | "calendar" | "tasks";
export const TILE_ORDER: TileId[] = ["messages", "requests", "firm", "calendar", "tasks"];
export const TILE_LABEL: Record<TileId, string> = { messages: "Messages", requests: "Client requests", firm: "Georgia is waiting", calendar: "Calendar", tasks: "Tasks" };

export interface TodayItem {
  key: string; title: string; sub?: string; badge?: string;
  /** The client this is about, when it is matched to one: the item opens their page. */
  contactId?: string | null; contactName?: string | null;
  /** Where the title goes; external addresses (Gmail, Google Calendar) open in a new tab. */
  href?: string | null;
  /** Marking it done by hand (the briefing's dismiss) is offered when there is a key for it. */
  doneKey?: string;
}
export interface TodayGroup {
  id: string; label: string; items: TodayItem[];
  /** Shown folded away (the rest of the week, what Georgia is working on). */
  collapsed?: boolean;
  /** Counts toward what is "new": false for groups that are only there for reference. */
  watch?: boolean;
  link?: { to: string; label: string; testId?: string };
}
export interface Tile { /** The number on the button. */ count: number; groups: TodayGroup[] }

type Task = { id?: string; title: string; project: string | null; due_date?: string; link: string | null };
export interface LiveToday {
  mailOk: boolean;
  texts: { key: string; label: string; contact: string | null; contactId: string | null; link: string }[];
  requests: { key: string; contact: string; contactId: string | null; type: string; description: string; created_at: string; link: string }[];
  newReplies: BriefingSections["replies"]; newIa: BriefingSections["ia"];
  matches: Record<string, { id: string; name: string }>;
  /** Keys of mail the inbox sweep put in FYI or Would archive (or from a sender sorted that way): not shown under To reply to. */
  hide?: string[];
  calendar?: { schedule: BriefingSections["schedule"]; week: BriefingSections["week"] } | null;
  tasks?: { overdue: Task[]; dueToday: Task[]; upcoming: Task[]; georgia: Task[] };
}

const senderName = (from: string) => String(from ?? "").replace(/<[^>]*>/g, "").replace(/["']/g, "").trim() || from;
const eventKey = (e: { start: string; summary: string }) => `event:${e.start}|${e.summary}`;
const dueText = (d?: string) => (d ? `due ${dayLabel(d)}` : undefined);

/** The lists behind the buttons: the morning briefing's, brought up to date with what is live. */
export function buildTiles(s: BriefingSections | null, live: LiveToday | null): Record<TileId, Tile> {
  const dismissed = new Set(s?.dismissed ?? []);
  const quiet = new Set(live?.hide ?? []);
  const keep = <T extends { key?: string }>(xs: T[]) => xs.filter((x) => !x.key || !dismissed.has(x.key));

  const texts: TodayItem[] = live
    ? live.texts.map((t) => ({ key: t.key, title: t.contact ?? "Unknown number", sub: t.label, contactId: t.contactId, contactName: t.contact, href: t.contactId ? `/contacts/${t.contactId}` : t.link, doneKey: t.key }))
    : (s?.texts ?? []).map((t) => ({ key: t.key ?? `text:${t.label}`, title: t.contact ?? "Unknown number", sub: t.label, href: t.link, doneKey: t.key }));
  const mail = <T extends { key?: string; from: string; subject: string; link: string }>(xs: T[]): TodayItem[] =>
    keep(xs).map((e) => { const m = e.key ? live?.matches[e.key] : undefined; return { key: e.key ?? e.link, title: e.subject, sub: senderName(e.from), contactId: m?.id ?? null, contactName: m?.name ?? null, href: e.link, doneKey: e.key }; });
  const replies = mail([...(s?.replies ?? []), ...(live?.newReplies ?? [])].filter((r) => !r.key || !quiet.has(r.key)));
  const ia = mail([...(s?.ia ?? []), ...(live?.newIa ?? [])]);
  const messages: TodayGroup[] = [
    { id: "texts", label: "Calls and texts", items: texts, link: { to: "/inbox", label: "Open the full inbox", testId: "open-full-inbox" } },
    { id: "replies", label: "To reply to", items: replies },
    { id: "ia", label: "iA and Adobe Sign", items: ia },
  ];

  const requests: TodayItem[] = (live?.requests ?? []).map((r) => ({ key: r.key, title: r.contact, sub: `${r.type.replace(/_/g, " ")}: ${r.description}`, contactId: r.contactId, contactName: r.contact, href: r.contactId ? `/contacts/${r.contactId}` : r.link }));
  const firm: TodayItem[] = keep(s?.firm ?? []).map((f) => ({ key: f.key ?? f.label, title: f.label, href: f.link, doneKey: f.key }));

  // The calendar as it is now when it has loaded, otherwise the morning's.
  const sched = live?.calendar?.schedule ?? s?.schedule ?? [];
  const week = live?.calendar?.week ?? s?.week ?? [];
  const ev = (e: { start: string; end?: string | null; allDay: boolean; summary: string; link: string | null; conflict?: boolean }): TodayItem => ({ key: eventKey(e), title: e.summary, sub: clock(e.start, e.allDay), badge: e.conflict ? "Overlaps" : undefined, href: e.link });
  const calendar: TodayGroup[] = [
    { id: "today", label: "Today", items: sched.map(ev) },
    ...week.map((d) => ({ id: `day:${d.date}`, label: dayLabel(d.date), items: d.items.map((i) => ev({ ...i, end: null })) })),
  ];

  const task = (t: Task, badge?: string): TodayItem => ({ key: `task:${t.id ?? t.title}`, title: t.title, sub: [t.project, dueText(t.due_date)].filter(Boolean).join(" · ") || undefined, badge, href: t.link });
  const lt = live?.tasks;
  const tasks: TodayGroup[] = lt ? [
    { id: "overdue", label: "Overdue", items: lt.overdue.map((t) => task(t, "Overdue")) },
    { id: "due", label: "Due today", items: lt.dueToday.map((t) => task(t)) },
    { id: "week", label: "This week", items: lt.upcoming.map((t) => task(t)), collapsed: true, watch: false },
    { id: "georgia", label: "Georgia is working on", items: lt.georgia.map((t) => task(t)), collapsed: true, watch: false },
  ] : [];

  const tile = (groups: TodayGroup[], count?: number): Tile => ({ groups, count: count ?? groups.filter((g) => g.watch !== false).reduce((n, g) => n + g.items.length, 0) });
  return {
    messages: tile(messages),
    requests: tile([{ id: "requests", label: "Waiting on your reply", items: requests, link: { to: "/ask-georgia", label: "Open Ask Georgia" } }]),
    firm: tile([{ id: "firm", label: "Georgia is waiting on you", items: firm }]),
    calendar: tile(calendar, sched.length),
    tasks: tile(tasks),
  };
}

/** Every item in a tile that counts toward "new". */
export const watched = (t: Tile): TodayItem[] => t.groups.filter((g) => g.watch !== false).flatMap((g) => g.items);
/** The items not seen before: their keys are not in what was remembered. Nothing is new before anything has been remembered. */
export const newKeys = (items: TodayItem[], seen: string[] | null): string[] => (seen === null ? [] : items.map((i) => i.key).filter((k) => !seen.includes(k)));

const store = (tile: TileId) => `today-seen:${tile}`;
/** What was seen the last time the panel was open; null when nothing is remembered yet (the first visit, or a cleared browser). */
export function loadSeen(tile: TileId): string[] | null {
  try { const raw = localStorage.getItem(store(tile)); return raw ? (JSON.parse(raw) as string[]) : null; } catch { return null; }
}
export function saveSeen(tile: TileId, keys: string[]) {
  try { localStorage.setItem(store(tile), JSON.stringify(keys.slice(-300))); } catch { /* remembered next time */ }
}
