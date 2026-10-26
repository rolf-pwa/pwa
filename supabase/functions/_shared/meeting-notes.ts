// meeting-notes.ts: reading a Google Meet "Notes by Gemini" document well enough to know which meeting it is and who was in it. Pure.
// The notes' own wording (summary, decisions, details, transcript) goes to the drafting model whole; this only identifies the meeting.

export interface NotesName { eventTitle: string | null; startIso: string; ymd: string }

/** "Interim Strategy Consultation (Shiven Khera) - 2026/10/13 12:00 PDT - Notes by Gemini", or "Meeting started 2026/08/21 13:33 PDT - Notes by Gemini". */
export function parseNotesName(name: string): NotesName | null {
  const m = /^(.*?)\s*-?\s*(\d{4})\/(\d{2})\/(\d{2})\s+(\d{1,2}):(\d{2})\s+(PDT|PST|PT)\s*-\s*Notes by Gemini\s*$/i.exec(name.trim());
  if (!m) return null;
  const [, rawTitle, y, mo, d, h, mi, zone] = m;
  // PT is the permanent B.C. time (UTC-7) from 2026-11-01.
  const offset = zone.toUpperCase() === "PST" ? 8 : 7;
  const startIso = new Date(Date.UTC(+y, +mo - 1, +d, +h + offset, +mi)).toISOString();
  const title = rawTitle.replace(/^Meeting started\s*$/i, "").trim();
  return { eventTitle: title || null, startIso, ymd: `${y}-${mo}-${d}` };
}

export const isNotesName = (name: string): boolean => /Notes by Gemini\s*$/i.test(name.trim());

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
export function extractEmails(text: string): string[] {
  return [...new Set((String(text).match(EMAIL) ?? []).map((e) => e.toLowerCase()))];
}

/** The calendar link in the notes ("Attachments" line): its eid names the event. */
export function extractEid(html: string): string | null {
  const m = /calendar\.google\.com\/calendar\/(?:u\/\d+\/)?event\?(?:[^"'\s<>]*&(?:amp;)?)?eid=([A-Za-z0-9_-]+)/i.exec(String(html));
  return m ? m[1] : null;
}

/** An eid is the event id and the calendar's address, joined by a space and base64url-encoded. */
export function decodeEid(eid: string): { eventId: string; calendarId: string } | null {
  try {
    const b64 = eid.replace(/-/g, "+").replace(/_/g, "/");
    const text = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
    const [eventId, calendarId] = text.split(" ");
    return eventId && /^[a-z0-9_]{5,}$/i.test(eventId) && calendarId?.includes("@") ? { eventId, calendarId } : null;
  } catch {
    return null;
  }
}

export interface NextStep { owners: string[]; task: string; detail: string }

/** Gemini writes "[Rolf Issler] Send Diagnostic Materials: Send the email..." or "[A, B] Task: detail". */
export function parseNextSteps(text: string): NextStep[] {
  const out: NextStep[] = [];
  for (const line of String(text).split(/\r?\n/)) {
    const m = /^\s*(?:[-*•●○▪]\s*)?\\?\[([^\]]+)\\?\]\s*([^:]+?):\s*(.*)$/.exec(line.replace(/\\\[/g, "[").replace(/\\\]/g, "]"));
    if (m) out.push({ owners: m[1].split(/\s*,\s*/).map((s) => s.trim()).filter(Boolean), task: m[2].trim(), detail: m[3].trim() });
  }
  return out;
}

/** The text after a heading line (exactly "Summary", "Next steps" and so on) up to the next heading, from the document's plain text. */
export function section(plain: string, heading: string, stops: string[]): string {
  const lines = String(plain).split(/\r?\n/);
  const norm = (s: string) => s.trim().replace(/^#+\s*/, "").replace(/\*+/g, "").toLowerCase();
  const start = lines.findIndex((l) => norm(l) === heading.toLowerCase());
  if (start < 0) return "";
  const end = lines.findIndex((l, i) => i > start && stops.some((s) => norm(l) === s.toLowerCase() || norm(l).startsWith(`${s.toLowerCase()} `)));
  return lines.slice(start + 1, end < 0 ? undefined : end).join("\n").trim();
}

export const NOTES_HEADINGS = ["Summary", "Decisions", "Next steps", "Details", "Transcript"];

export interface ParsedNotes { invited: string[]; eid: string | null; nextSteps: NextStep[] }

export function parseNotes(plain: string, html: string): ParsedNotes {
  const head = String(plain).split(/\r?\n/).slice(0, 40).join("\n");
  const invited = extractEmails(head);
  const steps = parseNextSteps(section(plain, "Next steps", NOTES_HEADINGS.filter((h) => h !== "Next steps")));
  return { invited, eid: extractEid(html), nextSteps: steps };
}
