// meeting-reminders.ts: Georgia's reminders for booked meetings, one week and one day before. Pure (no I/O) so it can be unit-tested.
// They replace Google's own appointment reminders. Only meetings of a type marked "Georgia sends reminders" are covered, and a
// reminder is sent only if the meeting was booked early enough for it to make sense (no "one week" reminder for a meeting
// booked three days ahead; the booking confirmation covers that).

import "./bc-time.ts";
export type ReminderKind = "7d" | "1d";
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export interface ReminderType { label: string; client_label: string | null; reminders: boolean; event_title?: string | null }

/** The meeting type an event belongs to, from its title ("Charter Review (Colleen Jerczynski)" is a "Charter Review"). */
export function matchReminderType<T extends ReminderType>(summary: string | null | undefined, types: T[], aliases: Record<string, string> = { "charter review": "Governance Review", "system review": "Sovereignty Review" }): T | null {
  const title = String(summary ?? "").toLowerCase().trim();
  if (!title) return null;
  const head = title.split(/\s*[(\-–:|]\s*/)[0] || title;
  const names = (t: T) => [t.label, t.event_title].filter(Boolean).map((n) => String(n).toLowerCase());
  const byLabel = types.filter((t) => t.reminders).find((t) => names(t).some((n) => head === n || title.includes(n)));
  if (byLabel) return byLabel;
  for (const [alias, target] of Object.entries(aliases)) {
    if (title.includes(alias)) return types.filter((t) => t.reminders).find((t) => t.label.toLowerCase() === target.toLowerCase()) ?? null;
  }
  return null;
}

/**
 * Which reminders are due right now for a meeting starting at `startMs`, booked at `createdMs`.
 *  7d: from a week before until a day after that (so one tick missed does not lose it); skipped if booked after that moment.
 *  1d: from a day before until two hours before the meeting; skipped if booked after that moment.
 */
export function remindersDue(startMs: number, createdMs: number | null, now: number): ReminderKind[] {
  if (!Number.isFinite(startMs) || startMs <= now) return [];
  const out: ReminderKind[] = [];
  const booked = (due: number) => createdMs === null || createdMs <= due + 5 * 60_000;
  const d7 = startMs - 7 * DAY;
  if (now >= d7 && now <= d7 + DAY && booked(d7)) out.push("7d");
  const d1 = startMs - DAY;
  if (now >= d1 && now <= startMs - 2 * HOUR && booked(d1)) out.push("1d");
  return out;
}

/** May a reminder go out now? Daytime Pacific, any day (a Monday meeting's one-day reminder goes on Sunday). */
export function inReminderHours(now: number, startHour = 8, endHour = 20): boolean {
  const hour = Number(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Vancouver", hour: "numeric", hour12: false }).format(new Date(now))) % 24;
  return hour >= startHour && hour < endHour;
}

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function whenLabel(startMs: number, tz = "America/Vancouver"): string {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: tz, weekday: "long", month: "long", day: "numeric" }).format(new Date(startMs));
  const time = new Intl.DateTimeFormat("en-CA", { timeZone: tz, hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(startMs));
  return `${day} at ${time}`;
}

/** "tomorrow", "today", "in a week", or the date, by calendar day in the meeting's time zone. */
export function relativeDay(startMs: number, now: number, tz = "America/Vancouver"): string {
  const ymd = (ms: number) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
  const diff = Math.round((Date.parse(`${ymd(startMs)}T00:00:00Z`) - Date.parse(`${ymd(now)}T00:00:00Z`)) / DAY);
  if (diff === 0) return "today";
  if (diff === 1) return "tomorrow";
  if (diff === 6 || diff === 7) return "in a week";
  return `in ${diff} days`;
}

export function reminderEmail(i: { firstName: string; meetingName: string; startMs: number; now: number; tz?: string; joinUrl?: string | null; location?: string | null; portalUrl: string; fromLine: string }): { subject: string; html: string } {
  const tz = i.tz || "America/Vancouver";
  const rel = relativeDay(i.startMs, i.now, tz);
  const where = i.joinUrl
    ? `<p style="margin:16px 0;"><a href="${i.joinUrl}" style="background:#1e293b;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:6px;font-size:14px;">Join the meeting</a></p>`
    : i.location ? `<p style="font-size:14px;line-height:1.6;">Where: ${escape(i.location)}</p>` : "";
  return {
    subject: `Reminder: your ${i.meetingName} is ${rel}`,
    html: `
    <div style="font-family:'DM Sans',sans-serif;color:#334155;max-width:520px;margin:0 auto;">
      <p style="font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:#94a3b8;">Sovereignty Operating System™</p>
      <p style="font-size:14px;line-height:1.6;">Hi ${escape(i.firstName || "there")},</p>
      <p style="font-size:14px;line-height:1.6;">A reminder that your <strong>${escape(i.meetingName)}</strong> with Rolf is ${rel}: <strong>${escape(whenLabel(i.startMs, tz))}</strong>.</p>
      ${where}
      <p style="font-size:14px;line-height:1.6;">If you need to change the time, reply to this email or open <a href="${i.portalUrl}" style="color:#a37c58;">your portal</a>.</p>
      <p style="font-size:13px;line-height:1.6;color:#64748b;">This is an automated email from ${i.fromLine}. If you need to get in touch with Rolf, just reply to this email, and I'll make sure he gets it.</p>
      <p style="font-size:14px;line-height:1.6;margin-top:24px;">Georgia<br/><span style="font-size:12px;color:#94a3b8;">AI Assistant, ProsperWise</span></p>
    </div>`.trim(),
  };
}
