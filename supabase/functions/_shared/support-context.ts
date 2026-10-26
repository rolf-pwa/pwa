// support-context.ts: what Ask Georgia is told about the person she is talking to and about Rolf's availability. Pure.

import "./bc-time.ts";
export interface Away { away_from: string | null; away_until: string | null; note: string | null }

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Rolf's date and weekday in Pacific time. */
export function pacificParts(now: Date): { date: string; weekday: number; time: string } {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Vancouver", year: "numeric", month: "2-digit", day: "2-digit", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false });
  const p = Object.fromEntries(f.formatToParts(now).map((x) => [x.type, x.value]));
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday);
  return { date: `${p.year}-${p.month}-${p.day}`, weekday, time: `${p.hour === "24" ? "00" : p.hour}:${p.minute}` };
}

function nextBusinessDay(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  do d.setUTCDate(d.getUTCDate() + 1); while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
  return d.toISOString().slice(0, 10);
}

function dayName(date: string): string {
  return DAYS[new Date(`${date}T12:00:00Z`).getUTCDay()];
}

export interface Availability { away: boolean; weekend: boolean; backOn: string | null; line: string }

/** Whether Rolf is away (dates set, or a weekend), and the sentence Georgia is given about it. */
export function availability(away: Away | null, now: Date): Availability {
  const { date, weekday } = pacificParts(now);
  const weekend = weekday === 0 || weekday === 6;
  const inRange = !!away?.away_until && date <= away.away_until && (!away.away_from || date >= away.away_from);
  if (inRange) {
    const back = nextBusinessDay(away!.away_until!);
    const extra = away!.note ? ` ${away!.note}` : "";
    return { away: true, weekend, backOn: back, line: `Rolf is out of the office until ${dayName(away!.away_until!)} ${away!.away_until}, and is back ${dayName(back)} ${back}.${extra}` };
  }
  if (weekend) {
    const back = nextBusinessDay(date);
    return { away: true, weekend, backOn: back, line: `It is the weekend. Rolf is back ${dayName(back)} ${back}.` };
  }
  return { away: false, weekend, backOn: null, line: "Rolf is working today, during normal business hours." };
}

export interface SupportInput {
  firstName: string | null;
  requests: { request_type: string; status: string; created_at: string; request_description: string }[];
  bookable: string[];
  booked: { label: string; start: string }[];
  away: Away | null;
  now: Date;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

/** The facts block appended to Georgia's prompt for one client chat. */
export function buildSupportContext(i: SupportInput): string {
  const a = availability(i.away, i.now);
  const p = pacificParts(i.now);
  const open = i.requests.filter((r) => r.status !== "resolved").slice(0, 8);
  const lines = [
    "## About this conversation",
    `Client: ${i.firstName || "unknown"}. Today is ${DAYS[p.weekday]} ${p.date}, ${p.time} Pacific.`,
    `Availability: ${a.line}`,
    open.length
      ? `Their open requests:\n${open.map((r) => `- ${r.request_type.replace(/_/g, " ")} (${r.status === "submitted" ? "received, not yet started" : r.status.replace(/_/g, " ")}), sent ${r.created_at.slice(0, 10)}: ${clip(r.request_description || "", 120)}`).join("\n")}`
      : "They have no open requests.",
    i.booked.length ? `Meetings already booked: ${i.booked.map((b) => `${b.label} on ${b.start.slice(0, 10)}`).join("; ")}.` : "They have no meeting booked.",
    i.bookable.length ? `Meetings they can book right now: ${i.bookable.join("; ")}.` : "No meeting is open for them to book right now.",
  ];
  return lines.join("\n");
}

export const MAX_STORED_MESSAGES = 60;
export const MAX_MESSAGE_CHARS = 4000;

export type ThreadRole = "user" | "assistant" | "advisor";
export interface ThreadMessage { role: ThreadRole; content: string; at?: string }

/** What is stored of a chat: roles and text only, bounded. */
export function storableMessages(messages: unknown): ThreadMessage[] {
  if (!Array.isArray(messages)) return [];
  return messages
    .filter((m: any) => m && (m.role === "user" || m.role === "assistant" || m.role === "advisor") && typeof m.content === "string")
    .slice(-MAX_STORED_MESSAGES)
    .map((m: any) => ({ role: m.role, content: String(m.content).slice(0, MAX_MESSAGE_CHARS), ...(typeof m.at === "string" ? { at: m.at } : {}) }));
}

/** The thread as the model reads it: Rolf's own words are shown as written by him, so she builds on them and never contradicts them. */
export function modelTurns(messages: ThreadMessage[]): { role: "user" | "model"; parts: { text: string }[] }[] {
  return messages.map((m) => ({
    role: m.role === "assistant" ? "model" as const : "user" as const,
    parts: [{ text: m.role === "advisor" ? `[Rolf, the advisor, wrote to the client]: ${m.content}` : m.content }],
  }));
}

/** The one new thing a client says this turn: the last client message in what the page sent. */
export function newClientMessage(body: { message?: unknown; messages?: unknown }): string | null {
  const text = typeof body.message === "string"
    ? body.message
    : Array.isArray(body.messages) ? [...body.messages].reverse().find((m: any) => m?.role === "user" && typeof m.content === "string")?.content : null;
  const t = typeof text === "string" ? text.trim().slice(0, MAX_MESSAGE_CHARS) : "";
  return t || null;
}

/** Only meeting labels the page says are bookable, as short plain strings. */
export function cleanLabels(v: unknown, max = 12): string[] {
  return Array.isArray(v) ? v.filter((x) => typeof x === "string" && x.trim()).map((x) => clip(x.trim(), 80)).slice(0, max) : [];
}
