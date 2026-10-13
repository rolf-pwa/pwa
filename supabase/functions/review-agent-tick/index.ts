// review-agent-tick: Georgia's review windows. Every 30 minutes (pg_cron, shared-secret header, Canada pinned) it keeps each
// family's meeting obligations up to date and works each through the policy in _shared/review-windows.ts.
//   mode off     does nothing
//   mode shadow  decides and records what it WOULD do; sends nothing and creates no tasks
//   mode live    invites both adults by email, reminds, and hands a family to a person (a task for Rolf) when needed
// Only windows that start after config.since are managed, so nothing already under way is touched.
// A booking is detected from Rolf's calendar: an event in the window, titled for the meeting, with one of the family's adults.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendServiceEmailDetailed } from "../_shared/service-email.ts";
import { getServiceGoogleAccessToken } from "../_shared/google-token.ts";
import { fetchThread } from "../_shared/gmail-read.ts";
import { triageReply } from "../_shared/reply-triage.ts";
import { SNOOZE_DAYS_STAFF, cleanReply, inboundReplies, replyAction } from "../_shared/onboarding-replies.ts";
import { AGENT_SENDER, PORTAL_URL } from "../_shared/onboarding-agent.ts";
import { FROM_LINE } from "../_shared/balance-notice.ts";
import { logSystemHealth } from "../_shared/system-health.ts";
import {
  DEFAULT_REVIEW_CONFIG, REVIEW_TASK_TITLE, decideReview, inviteesOf, kindFromTitle, pacificDate, requiredMeetings, reviewTaskBody, windowEmail,
  type FamilyContact, type ReviewConfig, type ReviewKind, type Tier,
} from "../_shared/review-windows.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("REVIEW_AGENT_CRON_SECRET");
const ESCALATION_ASSIGNEE_EMAIL = "rolf@prosperwise.ca";
const MAX_OBLIGATIONS = 80;
const DAY = 86_400_000;

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });

type Summary = Record<string, number> & { errors: string[] };
const familyTitle = (name: string | null) => { const n = (name ?? "").trim(); return !n ? "Family" : /\bfamily$/i.test(n) ? n : `${n} Family`; };

Deno.serve(async (req) => {
  if (!CRON_SECRET || req.headers.get("x-review-agent-cron-secret") !== CRON_SECRET) return json({ error: "unauthorized" }, 401);
  const summary: Summary = { created: 0, cancelled: 0, evaluated: 0, booked: 0, held: 0, nudges: 0, escalations: 0, waiting: 0, errors: [] };
  try {
    const { data: c } = await db.from("review_agent_config").select("*").eq("id", true).maybeSingle();
    if (!c || c.mode === "off") return json({ ok: true, mode: "off" });
    const mode = c.mode as "shadow" | "live";
    const cfg: ReviewConfig = { ...DEFAULT_REVIEW_CONFIG, remindEveryDays: c.remind_every_days, handoffDaysBeforeEnd: c.handoff_days_before_end, maxNudges: c.max_nudges, sendStartHour: c.send_start_hour, sendEndHour: c.send_end_hour, weekdaysOnly: c.weekdays_only };
    const now = Date.now();
    const today = pacificDate(now);
    const sinceDate = pacificDate(Date.parse(c.since));

    // 1. Keep each family's obligations in step with its tier.
    const { data: families } = await db.from("families").select("id, name, service_tier").not("service_tier", "is", null);
    const { data: allContacts } = await db.from("contacts").select("id, family_id, first_name, last_name, email, family_role, is_minor").in("family_id", (families ?? []).map((f: any) => f.id));
    const contactsOf = new Map<string, FamilyContact[]>();
    for (const p of allContacts ?? []) {
      const list = contactsOf.get(p.family_id) ?? [];
      list.push({ id: p.id, firstName: p.first_name, lastName: p.last_name, email: p.email, role: p.family_role, isMinor: p.is_minor });
      contactsOf.set(p.family_id, list);
    }
    const year = Number(today.slice(0, 4));
    const years = today >= `${year}-10-01` ? [year, year + 1] : [year];
    const { data: existing } = await db.from("review_obligations").select("id, family_id, window_key, status").eq("mode", mode);
    const have = new Map<string, any>((existing ?? []).map((o: any) => [`${o.family_id}|${o.window_key}`, o]));
    const wanted = new Set<string>();
    for (const f of families ?? []) {
      for (const y of years) {
        for (const m of requiredMeetings(f.service_tier as Tier, y)) {
          const k = `${f.id}|${m.key}`;
          wanted.add(k);
          if (have.has(k) || m.windowStart < sinceDate || m.windowEnd < today) continue;
          const { data: row, error } = await db.from("review_obligations").insert({ family_id: f.id, kind: m.kind, window_key: m.key, window_start: m.windowStart, window_end: m.windowEnd, tier: f.service_tier, mode }).select("id").maybeSingle();
          if (!error && row) { summary.created++; await event(f.id, row.id, mode, "obligation_opened", { kind: m.kind, window: `${m.windowStart} to ${m.windowEnd}` }); }
        }
      }
    }
    // A tier change can make an unstarted obligation obsolete (Tier 1 becomes 2B, say): cancel it unless a meeting is already booked.
    for (const o of existing ?? []) {
      if (o.status === "open" && !wanted.has(`${o.family_id}|${o.window_key}`)) {
        await db.from("review_obligations").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", o.id);
        await event(o.family_id, o.id, mode, "obligation_cancelled", { reason: "the family's tier no longer owes this meeting" });
        summary.cancelled++;
      }
    }

    // 2. Work each live obligation.
    const { data: obligations } = await db.from("review_obligations").select("*").eq("mode", mode).in("status", ["open", "booked"]).gte("window_end", pacificDate(now - 7 * DAY)).order("window_start").limit(MAX_OBLIGATIONS);
    const familyById = new Map((families ?? []).map((f: any) => [f.id, f]));
    const calendarCache = new Map<string, any[]>();
    for (const o of obligations ?? []) {
      try { await work(o, familyById.get(o.family_id), contactsOf.get(o.family_id) ?? [], mode, cfg, now, summary, calendarCache); }
      catch (e) { summary.errors.push(`${o.family_id}: ${e instanceof Error ? e.message : String(e)}`); }
    }
    if (summary.errors.length) await logSystemHealth(db as any, { function_name: "review-agent-tick", severity: "WARN", error_code: "REVIEW_AGENT_PARTIAL", error_message: summary.errors.join("; ").slice(0, 900) });
    return json({ ok: true, mode, ...summary });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await logSystemHealth(db as any, { function_name: "review-agent-tick", severity: "ERROR", error_code: "REVIEW_AGENT_FAILED", error_message: message.slice(0, 900) });
    return json({ error: message }, 500);
  }
});

async function event(familyId: string | null, obligationId: string | null, mode: string, kind: string, detail: Record<string, unknown>) {
  await db.from("review_agent_events").insert({ family_id: familyId, obligation_id: obligationId, mode, kind, detail });
}

/** The family's adults' calendar events in and around the window, matched to this kind of meeting. */
async function findBooking(emails: string[], kind: ReviewKind, windowStart: string, windowEnd: string, cache: Map<string, any[]>): Promise<{ id: string; start: number } | null> {
  if (!emails.length) return null;
  const token = await getServiceGoogleAccessToken(db);
  const timeMin = new Date(Date.parse(`${windowStart}T00:00:00Z`) - 14 * DAY).toISOString();
  const timeMax = new Date(Date.parse(`${windowEnd}T23:59:59Z`) + DAY).toISOString();
  let best: { id: string; start: number } | null = null;
  for (const email of emails) {
    const key = `${email}|${timeMin}|${timeMax}`;
    if (!cache.has(key)) {
      const res = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events?" + new URLSearchParams({ timeMin, timeMax, maxResults: "100", singleEvents: "true", orderBy: "startTime", q: email }), { headers: { Authorization: `Bearer ${token}` } });
      cache.set(key, res.ok ? ((await res.json()).items ?? []) : []);
    }
    for (const ev of cache.get(key) ?? []) {
      if (ev.status === "cancelled" || kindFromTitle(ev.summary) !== kind) continue;
      const withFamily = (ev.attendees ?? []).some((a: any) => String(a.email ?? "").toLowerCase() === email) || String(ev.organizer?.email ?? "").toLowerCase() === email || String(ev.creator?.email ?? "").toLowerCase() === email;
      const startMs = Date.parse(ev.start?.dateTime ?? `${ev.start?.date}T12:00:00Z`);
      if (!withFamily || !Number.isFinite(startMs)) continue;
      if (!best || startMs < best.start || (best.start < Date.now() && startMs >= Date.now())) best = { id: ev.id, start: startMs };
    }
  }
  return best;
}

async function work(o: any, family: any, contacts: FamilyContact[], mode: "shadow" | "live", cfg: ReviewConfig, now: number, summary: Summary, cache: Map<string, any[]>) {
  if (!family) return;
  const invitees = inviteesOf(contacts);
  const allEmails = [...new Set(contacts.filter((p) => !p.isMinor && p.email).map((p) => String(p.email).trim().toLowerCase()))];
  const touch = (patch: Record<string, unknown>) => db.from("review_obligations").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", o.id);

  const booking = await findBooking(allEmails, o.kind, o.window_start, o.window_end, cache);
  if (booking && (booking.id !== o.booked_event_id)) {
    await touch({ booked_event_id: booking.id, booked_start: new Date(booking.start).toISOString(), status: booking.start < now ? o.status : "booked" });
    o = { ...o, booked_event_id: booking.id, booked_start: new Date(booking.start).toISOString() };
    await event(o.family_id, o.id, mode, "booking_detected", { start: new Date(booking.start).toISOString() });
    summary.booked++;
  } else if (!booking && o.status === "booked" && o.booked_start && Date.parse(o.booked_start) > now) {
    // The meeting was cancelled or moved off the calendar: open again.
    await touch({ status: "open", booked_event_id: null, booked_start: null });
    o = { ...o, status: "open", booked_event_id: null, booked_start: null };
    await event(o.family_id, o.id, mode, "booking_removed", {});
  }

  // Replies to Georgia's invitations (live only: shadow sends nothing, so there is nothing to reply to).
  if (mode === "live" && (o.thread_ids ?? []).length && !booking) {
    if (await handleReplies(o, family, contacts, summary)) return;
  }

  const d = decideReview({
    now, status: o.status, windowStart: o.window_start, windowEnd: o.window_end, bookedStart: o.booked_start ? Date.parse(o.booked_start) : null,
    recipients: invitees.length, nudgeCount: o.nudge_count, lastNudgeAt: o.last_nudge_at ? Date.parse(o.last_nudge_at) : null, snoozedUntil: o.snoozed_until ? Date.parse(o.snoozed_until) : null,
  }, cfg);
  summary.evaluated++;
  if (d.kind === "wait") { summary.waiting++; return; }
  if (d.kind === "booked") { summary.waiting++; return; }
  if (d.kind === "held") {
    await touch({ status: "held" });
    await event(o.family_id, o.id, mode, "held", { start: o.booked_start });
    summary.held++;
    return;
  }

  if (d.kind === "nudge") {
    const fromLine = FROM_LINE;
    if (mode === "live") {
      const threadIds = [...(o.thread_ids ?? [])];
      const sentIds = [...(o.sent_message_ids ?? [])];
      let sentAny = false;
      for (const p of invitees) {
        const { subject, html } = windowEmail({ firstName: p.firstName, kind: o.kind, windowEnd: o.window_end, reminder: d.reminder, portalUrl: PORTAL_URL, fromLine });
        const sent = await sendServiceEmailDetailed(db, { to: p.email, subject, html, from: Deno.env.get("ONBOARDING_AGENT_FROM") || AGENT_SENDER });
        if (sent.ok) { sentAny = true; if (sent.threadId) threadIds.push(sent.threadId); if (sent.messageId) sentIds.push(sent.messageId); }
        else summary.errors.push(`${o.family_id}: email to a contact failed`);
      }
      if (!sentAny) { await event(o.family_id, o.id, mode, "nudge_failed", {}); return; }
      await touch({ thread_ids: [...new Set(threadIds)].slice(-8), sent_message_ids: sentIds.slice(-30) });
    }
    await touch({ nudge_count: o.nudge_count + 1, last_nudge_at: new Date().toISOString() });
    await event(o.family_id, o.id, mode, mode === "live" ? "invitation_sent" : "invitation_would_send", { kind: o.kind, reminder: d.reminder, to: invitees.length, window: `${o.window_start} to ${o.window_end}` });
    summary.nudges++;
    return;
  }

  await escalate(o, family, mode, d.reason, d.detail, undefined, invitees);
  summary.escalations++;
}

async function escalate(o: any, family: any, mode: "shadow" | "live", reason: string, detail: string, replyPreview: string | undefined, invitees: { contactId: string }[]) {
  let taskId: string | null = null;
  const name = familyTitle(family.name);
  if (mode === "live") {
    const { data: rolf } = await db.from("profiles").select("user_id").eq("email", ESCALATION_ASSIGNEE_EMAIL).maybeSingle();
    if (rolf?.user_id) {
      const { data: task } = await db.from("pm_tasks").insert({
        title: REVIEW_TASK_TITLE(name, o.kind), status: "open", client_visible: false, assignee_id: rolf.user_id, created_by: rolf.user_id, family_id: o.family_id,
        contact_id: invitees[0]?.contactId ?? null, due_date: o.window_end < pacificDate(Date.now()) ? pacificDate(Date.now()) : o.window_end,
        description: reviewTaskBody({ reason, detail, family: name, kind: o.kind, windowStart: o.window_start, windowEnd: o.window_end, nudges: o.nudge_count, replyPreview }),
      }).select("id").maybeSingle();
      taskId = task?.id ?? null;
    }
    await db.from("staff_notifications").insert({ title: REVIEW_TASK_TITLE(name, o.kind), body: detail, link: `/families/${o.family_id}`, contact_id: invitees[0]?.contactId ?? null, source_type: "review_agent" });
  }
  await db.from("review_obligations").update({ status: "escalated", escalation_reason: reason, escalation_task_id: taskId, updated_at: new Date().toISOString() }).eq("id", o.id);
  await event(o.family_id, o.id, mode, mode === "live" ? "escalated" : "would_escalate", { reason, detail, taskId });
}

/** Looks for replies to the invitations. Georgia never writes back: a plain acknowledgement pauses her, anything else goes to a person. */
async function handleReplies(o: any, family: any, contacts: FamilyContact[], summary: Summary): Promise<boolean> {
  const token = await getServiceGoogleAccessToken(db);
  const messages = (await Promise.all((o.thread_ids as string[]).map((t) => fetchThread(token, t)))).flat();
  const { client, staff } = inboundReplies(messages, { sentIds: o.sent_message_ids ?? [], handledIds: o.handled_message_ids ?? [] });
  const touch = (patch: Record<string, unknown>) => db.from("review_obligations").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", o.id);
  const handled = [...(o.handled_message_ids ?? [])];
  const invitees = inviteesOf(contacts);

  if (staff.length && !client.length) {
    await touch({ handled_message_ids: [...handled, ...staff.map((m) => m.id)].slice(-60), snoozed_until: new Date(Date.now() + SNOOZE_DAYS_STAFF * DAY).toISOString() });
    await event(o.family_id, o.id, "live", "staff_replied", { waitDays: SNOOZE_DAYS_STAFF });
    return true;
  }
  if (!client.length) return false;
  const reply = client[0];
  const text = cleanReply(reply.text);
  const triaged = await triageReply(text, [family.name, ...contacts.map((p) => p.firstName ?? "")].filter(Boolean) as string[]);
  if (triaged.failed) summary.errors.push(`${o.family_id}: reply classification failed: ${triaged.failed}`);
  const action = replyAction(triaged.intent, text);
  await event(o.family_id, o.id, "live", "reply_received", { intent: triaged.intent, summary: triaged.summary, messageId: reply.id });
  await touch({ handled_message_ids: [...handled, reply.id].slice(-60) });
  if (action.kind === "snooze") {
    await touch({ snoozed_until: new Date(Date.now() + 14 * DAY).toISOString() });
    await event(o.family_id, o.id, "live", "reply_snoozed", { waitDays: 14 });
    return true;
  }
  const detail = action.reason === "asked_to_stop" ? "The family asked us to stop emailing them." : `The family replied to an invitation${triaged.summary ? `: ${triaged.summary}` : "."}`;
  await escalate(o, family, "live", action.reason, detail, text || "(no readable text)", invitees);
  summary.escalations++;
  return true;
}
