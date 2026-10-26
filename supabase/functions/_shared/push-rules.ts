// What buzzes Rolf's phone, and when. Pure rules; the sending itself is in push-service.ts.

import "./bc-time.ts";
export const PUSH_CATEGORIES = ["texts", "calls", "requests", "documents", "alerts"] as const;
export type PushCategory = (typeof PUSH_CATEGORIES)[number];

export const PUSH_LABELS: Record<PushCategory, { label: string; hint: string }> = {
  texts: { label: "Texts", hint: "A client texts you, and urgent texts Georgia flags" },
  calls: { label: "Voicemails", hint: "A client leaves a voicemail" },
  requests: { label: "Client requests", hint: "New requests, replies, Ask Georgia flags and task replies" },
  documents: { label: "Signed documents", hint: "A client signs an insurance or investment document" },
  alerts: { label: "System alerts", hint: "Something in the system failed" },
};

/** The staff_notifications source types that buzz, and the kind each belongs to. Everything else stays in the bell only. */
const SOURCE_CATEGORY: Record<string, PushCategory> = {
  urgent_text: "texts",
  voicemail: "calls",
  new_request: "requests",
  request_message: "requests",
  ask_georgia_flag: "requests",
  task_client_reply: "requests",
  insurance_document: "documents",
  system_error: "alerts",
};

/** Urgent texts and system failures get through quiet hours. */
const BREAKS_QUIET = new Set(["urgent_text", "system_error"]);

export const categoryForSource = (source: string): PushCategory | null => SOURCE_CATEGORY[source] ?? null;
export const breaksQuietHours = (source: string) => BREAKS_QUIET.has(source);

/** Quiet hours are 9pm to 7am Pacific. */
export function isQuietHour(now: Date): boolean {
  const h = Number(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Vancouver", hour: "2-digit", hour12: false }).format(now)) % 24;
  return h >= 21 || h < 7;
}

export interface PushPrefs { categories: string[]; quiet: boolean }

export function shouldBuzz(category: PushCategory, source: string, prefs: PushPrefs, now: Date): boolean {
  if (!prefs.categories.includes(category)) return false;
  if (prefs.quiet && isQuietHour(now) && !breaksQuietHours(source)) return false;
  return true;
}

/** Unread bell items that count toward the red number on the icon. Texts and voicemails count through the inbox, so they are not listed twice. */
export const BADGE_SOURCES = ["new_request", "request_message", "ask_georgia_flag", "task_client_reply", "insurance_document", "system_error"] as const;

export interface PushPayload { title: string; body: string; url: string; tag: string; badge?: number }

/** The lock screen shows who and what kind, never the words: a client's message or a transcript should not sit on a locked phone. */
export function staffPayload(n: { id: string; title: string; link?: string | null; contact_id?: string | null; source_type: string }, badge?: number): PushPayload {
  return { title: n.title.slice(0, 120), body: "Tap to open", url: safePath(n.link) ?? "/briefing", tag: `${n.source_type}-${n.contact_id ?? n.id}`, badge };
}

export function textPayload(m: { id: string; contact_id?: string | null }, name: string | null, badge?: number): PushPayload {
  return { title: name ? `Text from ${name}` : "New text message", body: "Tap to open", url: m.contact_id ? `/contacts/${m.contact_id}` : "/briefing?tab=messages", tag: `text-${m.contact_id ?? m.id}`, badge };
}

/** Only paths inside the app: a notification must never open somewhere else. */
export function safePath(link?: string | null): string | null {
  return link && link.startsWith("/") && !link.startsWith("//") ? link : null;
}
