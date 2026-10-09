// Meeting types for booking (Google appointment schedules), kept in the meeting_types table. Pure helpers.

export interface MeetingType {
  id: string;
  label: string;
  client_label: string | null;
  minutes: number | null;
  note: string | null;
  url: string;
  embed_url: string | null;
  sort_order: number;
  active: boolean;
  staff_visible: boolean;
  client_visible: boolean;
}

const SCHEDULE = /^https:\/\/calendar\.google\.com\/calendar(?:\/u\/\d+)?\/appointments\/schedules\/([\w-]+)\/?(?:\?.*)?$/;

/** A pasted booking link, cleaned up. Only a schedule page link can be shown inside a page; a short link opens in a new tab. */
export function parseBookingLink(raw: string): { url: string; embed_url: string | null } | null {
  const text = raw.trim();
  const m = text.match(SCHEDULE);
  if (m) {
    const url = `https://calendar.google.com/calendar/appointments/schedules/${m[1]}`;
    return { url, embed_url: `${url}?gv=true` };
  }
  if (/^https:\/\/calendar\.app\.google\/[\w-]+\/?$/.test(text)) return { url: text.replace(/\/$/, ""), embed_url: null };
  return null;
}

export const forStaff = (types: MeetingType[]): MeetingType[] => [...types].filter((t) => t.active && t.staff_visible).sort((a, b) => a.sort_order - b.sort_order);

/** What the client portal shows: only active, client-visible types, under the name clients see. */
export const forClients = (types: Pick<MeetingType, "label" | "client_label" | "url" | "embed_url" | "active" | "client_visible" | "sort_order">[]) =>
  [...types].filter((t) => t.active && t.client_visible).sort((a, b) => a.sort_order - b.sort_order)
    .map((t) => ({ label: t.client_label || t.label, url: t.url, embedUrl: t.embed_url ?? t.url }));

/** Swaps a type with its neighbour and renumbers, so the order is always 0..n-1. */
export function moveType<T extends { id: string; sort_order: number }>(types: T[], id: string, dir: -1 | 1): T[] {
  const sorted = [...types].sort((a, b) => a.sort_order - b.sort_order);
  const i = sorted.findIndex((t) => t.id === id), j = i + dir;
  if (i < 0 || j < 0 || j >= sorted.length) return sorted.map((t, k) => ({ ...t, sort_order: k }));
  [sorted[i], sorted[j]] = [sorted[j], sorted[i]];
  return sorted.map((t, k) => ({ ...t, sort_order: k }));
}
