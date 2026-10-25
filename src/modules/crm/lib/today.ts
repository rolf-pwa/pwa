// today.ts: what the Today buttons show. Pure apart from the small "seen" store: the lists behind the buttons, which of their items are new, and what is remembered about
// what has been seen. Items open the contact they concern when there is one.
import type { BriefingSections } from "../../../../supabase/functions/_shared/briefing-facts";

export type TileId = "texts" | "replies" | "ia" | "firm" | "requests";
export const TILE_ORDER: TileId[] = ["texts", "replies", "ia", "firm", "requests"];
export const TILE_LABEL: Record<TileId, string> = { texts: "Calls and texts", replies: "To reply to", ia: "iA and Adobe Sign", firm: "Georgia is waiting", requests: "Client requests" };

export interface TodayItem {
  key: string; title: string; sub?: string;
  /** The client this is about, when it is matched to one: the item opens their page. */
  contactId?: string | null; contactName?: string | null;
  /** Where the title goes; external addresses (Gmail) open in a new tab. */
  href?: string | null;
  /** Marking it done by hand (the briefing's dismiss) is offered when there is a key for it. */
  doneKey?: string;
}

export interface LiveToday {
  mailOk: boolean;
  texts: { key: string; label: string; contact: string | null; contactId: string | null; link: string }[];
  requests: { key: string; contact: string; contactId: string | null; type: string; description: string; created_at: string; link: string }[];
  newReplies: BriefingSections["replies"]; newIa: BriefingSections["ia"];
  matches: Record<string, { id: string; name: string }>;
}

const isExternal = (h: string | null | undefined) => !!h && h.startsWith("http");
const senderName = (from: string) => String(from ?? "").replace(/<[^>]*>/g, "").replace(/["']/g, "").trim() || from;

/** The lists behind the buttons: the morning briefing's, brought up to date with what is live. Texts and requests are always the live ones once they have loaded. */
export function buildTiles(s: BriefingSections | null, live: LiveToday | null): Record<TileId, TodayItem[]> {
  const dismissed = new Set(s?.dismissed ?? []);
  const keep = <T extends { key?: string }>(xs: T[]) => xs.filter((x) => !x.key || !dismissed.has(x.key));
  const texts: TodayItem[] = live
    ? live.texts.map((t) => ({ key: t.key, title: t.contact ?? "Unknown number", sub: t.label, contactId: t.contactId, contactName: t.contact, href: t.contactId ? `/contacts/${t.contactId}` : t.link, doneKey: t.key }))
    : (s?.texts ?? []).map((t) => ({ key: t.key ?? `text:${t.label}`, title: t.contact ?? "Unknown number", sub: t.label, href: t.link, doneKey: t.key }));
  const mail = <T extends { key?: string; from: string; subject: string; link: string }>(xs: T[]): TodayItem[] =>
    keep(xs).map((e) => { const m = e.key ? live?.matches[e.key] : undefined; return { key: e.key ?? e.link, title: e.subject, sub: senderName(e.from), contactId: m?.id ?? null, contactName: m?.name ?? null, href: e.link, doneKey: e.key }; });
  const requests: TodayItem[] = (live?.requests ?? []).map((r) => ({ key: r.key, title: r.contact, sub: `${r.type.replace(/_/g, " ")}: ${r.description}`, contactId: r.contactId, contactName: r.contact, href: r.contactId ? `/contacts/${r.contactId}` : r.link }));
  return {
    texts,
    replies: mail([...(s?.replies ?? []), ...(live?.newReplies ?? [])]),
    ia: mail([...(s?.ia ?? []), ...(live?.newIa ?? [])]),
    firm: keep(s?.firm ?? []).map((f) => ({ key: f.key ?? f.label, title: f.label, href: f.link, doneKey: f.key })),
    requests,
  };
}

/** The items not seen before: their keys are not in what was remembered. */
export const newKeys = (items: TodayItem[], seen: string[] | null): string[] => (seen === null ? [] : items.map((i) => i.key).filter((k) => !seen.includes(k)));

const store = (tile: TileId) => `today-seen:${tile}`;
/** What was seen the last time the panel was open; null when nothing is remembered yet (the first visit, or a cleared browser). */
export function loadSeen(tile: TileId): string[] | null {
  try { const raw = localStorage.getItem(store(tile)); return raw ? (JSON.parse(raw) as string[]) : null; } catch { return null; }
}
export function saveSeen(tile: TileId, keys: string[]) {
  try { localStorage.setItem(store(tile), JSON.stringify(keys.slice(-300))); } catch { /* remembered next time */ }
}
