// meeting-reminder-tick: Georgia's reminders for booked meetings, one week and one day before. Every 30 minutes (pg_cron,
// shared-secret header, Canada pinned) it reads the next eight days of Rolf's calendar, finds meetings of a type marked for
// reminders that have a client as an attendee, and sends each due reminder once.
//   mode off     does nothing
//   mode shadow  records the reminders it WOULD send; sends nothing
//   mode live    emails the reminder from Georgia
// A meeting booked too late for a reminder to make sense (a week-ahead reminder for a meeting booked three days ahead) is skipped.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendServiceEmailDetailed } from "../_shared/service-email.ts";
import { getServiceGoogleAccessToken } from "../_shared/google-token.ts";
import { AGENT_SENDER, PORTAL_URL } from "../_shared/onboarding-agent.ts";
import { FROM_LINE } from "../_shared/balance-notice.ts";
import { logSystemHealth } from "../_shared/system-health.ts";
import { inReminderHours, matchReminderType, reminderEmail, remindersDue } from "../_shared/meeting-reminders.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("MEETING_REMINDER_CRON_SECRET");
const DAY = 86_400_000;

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (!CRON_SECRET || req.headers.get("x-meeting-reminder-cron-secret") !== CRON_SECRET) return json({ error: "unauthorized" }, 401);
  const summary = { events: 0, matched: 0, reminders: 0, skipped: 0, failed: 0, errors: [] as string[], unmatchedTitles: [] as string[] };
  try {
    const { data: c } = await db.from("meeting_reminder_config").select("*").eq("id", true).maybeSingle();
    if (!c || c.mode === "off") return json({ ok: true, mode: "off" });
    const mode = c.mode as "shadow" | "live";
    const now = Date.now();
    if (!inReminderHours(now, c.send_start_hour, c.send_end_hour)) return json({ ok: true, mode, quiet: true });

    const { data: types } = await db.from("meeting_types").select("label, client_label, reminders, event_title").eq("active", true);
    const { data: people } = await db.from("contacts").select("id, first_name, email, is_minor").eq("no_automated_email", false).not("email", "is", null);
    const byEmail = new Map<string, { id: string; firstName: string }>();
    for (const p of people ?? []) {
      const e = String(p.email ?? "").trim().toLowerCase();
      if (e && !p.is_minor) byEmail.set(e, { id: p.id, firstName: p.first_name ?? "" });
    }

    const token = await getServiceGoogleAccessToken(db);
    const res = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events?" + new URLSearchParams({
      timeMin: new Date(now - 3 * 3_600_000).toISOString(), timeMax: new Date(now + 8 * DAY + 3_600_000).toISOString(), maxResults: "250", singleEvents: "true", orderBy: "startTime",
    }), { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`calendar_failed [${res.status}]`);
    const events = (await res.json()).items ?? [];
    summary.events = events.length;

    for (const ev of events) {
      if (ev.status === "cancelled" || !ev.start?.dateTime) continue;
      const type = matchReminderType(ev.summary, (types ?? []) as any[]);
      if (!type) {
        // A meeting with a client that matches no type: say so, so the schedule can be added as a meeting type.
        const hasClient = (ev.attendees ?? []).some((a: any) => !a.self && !a.organizer && byEmail.has(String(a.email ?? "").trim().toLowerCase()));
        if (hasClient) summary.unmatchedTitles.push(String(ev.summary ?? "").split(/\s*\(/)[0].trim().slice(0, 60) || "(untitled)");
        continue;
      }
      summary.matched++;
      const startMs = Date.parse(ev.start.dateTime);
      const due = remindersDue(startMs, ev.created ? Date.parse(ev.created) : null, now);
      if (!due.length) continue;
      const tz = ev.start.timeZone || "America/Vancouver";
      const join = ev.hangoutLink || ev.conferenceData?.entryPoints?.find((p: any) => p.entryPointType === "video")?.uri || null;
      for (const a of ev.attendees ?? []) {
        // Never the calendar's owner (Rolf is on his own meetings), and never someone who declined.
        if (a.responseStatus === "declined" || a.self || a.organizer) continue;
        const person = byEmail.get(String(a.email ?? "").trim().toLowerCase());
        if (!person) continue;
        for (const kind of due) {
          // Claim this reminder first so a second tick, a retry or a restart can never send it twice.
          const { data: claimed, error } = await db.from("meeting_reminders").insert({ event_id: ev.id, contact_id: person.id, kind, start_time: new Date(startMs).toISOString(), mode, meeting_name: type.client_label || type.label }).select("id").maybeSingle();
          if (error) { if (error.code === "23505") summary.skipped++; else summary.errors.push(`claim: ${error.message}`); continue; }
          if (!claimed?.id) continue;
          if (mode === "shadow") { summary.reminders++; continue; }
          const { subject, html } = reminderEmail({ firstName: person.firstName, meetingName: type.client_label || type.label, startMs, now, tz, joinUrl: join, location: ev.location ?? null, portalUrl: PORTAL_URL, fromLine: FROM_LINE });
          const sent = await sendServiceEmailDetailed(db, { to: String(a.email).trim(), subject, html, from: Deno.env.get("ONBOARDING_AGENT_FROM") || AGENT_SENDER });
          await db.from("meeting_reminders").update({ email_ok: sent.ok }).eq("id", claimed.id);
          if (sent.ok) summary.reminders++; else summary.failed++;
        }
      }
    }
    await db.from("meeting_reminder_config").update({ last_unmatched: [...new Set(summary.unmatchedTitles)].slice(0, 20) }).eq("id", true);
    if (summary.errors.length || summary.failed) {
      await logSystemHealth(db as any, { function_name: "meeting-reminder-tick", severity: "WARN", error_code: "MEETING_REMINDER_PARTIAL", error_message: `${summary.failed} failed; ${summary.errors.join("; ")}`.slice(0, 900) });
    }
    return json({ ok: true, mode, ...summary });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await logSystemHealth(db as any, { function_name: "meeting-reminder-tick", severity: "ERROR", error_code: "MEETING_REMINDER_FAILED", error_message: message.slice(0, 900) });
    return json({ error: message }, 500);
  }
});
