// onboarding-agent-tick: Georgia's onboarding concierge. Every 15 minutes (pg_cron, shared-secret header, pinned to
// Canada Central) it works each open onboarding case through the policy in _shared/onboarding-agent.ts.
//   mode off     does nothing
//   mode shadow  decides and records what it WOULD do; sends nothing, builds nothing, creates no tasks
//   mode live    sends the reminder email, retries a failed Vault build, or escalates to a person (a task for Rolf + a notification)
// Only households that enrolled after config.since get a case, so existing clients are never contacted by it.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendServiceEmailDetailed } from "../_shared/service-email.ts";
import { getServiceGoogleAccessToken } from "../_shared/google-token.ts";
import { fetchThread } from "../_shared/gmail-read.ts";
import { SNOOZE_DAYS_STAFF, cleanReply, inboundReplies, replyAction } from "../_shared/onboarding-replies.ts";
import { triageReply } from "../_shared/reply-triage.ts";
import { provisionClientFolderTree } from "../_shared/vault-provisioning.ts";
import { logSystemHealth } from "../_shared/system-health.ts";
import { CHECKLIST, COMPLETE_COMMENT, CONCIERGE_KEY, ESCALATED_COMMENT, NUDGE_COMMENT, newlyDone, parentTitle, progressFrom, type ChecklistKey } from "../_shared/onboarding-checklist.ts";
import {
  AGENT_SENDER, DEFAULT_CONFIG, ESCALATION_TITLE, decideNext, escalationBody, nextNudgeCount, nudgeEmail,
  type AgentConfig, type CaseFacts, type Decision,
} from "../_shared/onboarding-agent.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("ONBOARDING_AGENT_CRON_SECRET");
// Escalations go to Rolf until households record an advisor.
const ESCALATION_ASSIGNEE_EMAIL = "rolf@prosperwise.ca";
const MAX_CASES = 40;
// The From header. Gmail only shows a custom display name ("Georgia, AI Assistant") when the address is a "send as" alias
// of the connected mailbox, so set ONBOARDING_AGENT_FROM to e.g. "Georgia, AI Assistant <georgia@prosperwise.ca>" once that alias exists.

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
const ms = (v: string | null | undefined) => (v ? Date.parse(v) : null);

Deno.serve(async (req) => {
  if (!CRON_SECRET || req.headers.get("x-onboarding-agent-cron-secret") !== CRON_SECRET) return json({ error: "unauthorized" }, 401);
  const summary: Record<string, number> & { errors: string[] } = { opened: 0, evaluated: 0, complete: 0, nudges: 0, vaultRetries: 0, escalations: 0, waiting: 0, errors: [] };
  try {
    const { data: c } = await db.from("onboarding_agent_config").select("*").eq("id", true).maybeSingle();
    if (!c || c.mode === "off") return json({ ok: true, mode: "off" });
    const mode = c.mode as "shadow" | "live";
    const cfg: AgentConfig = {
      ...DEFAULT_CONFIG, maxNudges: c.max_nudges, firstNudgeHours: c.first_nudge_hours, minGapHours: c.min_gap_hours,
      sendStartHour: c.send_start_hour, sendEndHour: c.send_end_hour, weekdaysOnly: c.weekdays_only,
    };

    // Open a case for each household that enrolled after `since` and has none in this mode.
    const { data: fresh } = await db.from("households").select("id, created_at").eq("onboarding_enabled", true).gte("created_at", c.since);
    const { data: existing } = await db.from("onboarding_cases").select("household_id").eq("mode", mode);
    const have = new Set((existing ?? []).map((r: any) => r.household_id));
    for (const h of fresh ?? []) {
      if (have.has(h.id)) continue;
      const { error } = await db.from("onboarding_cases").insert({ household_id: h.id, mode });
      if (!error) { summary.opened++; await event(h.id, null, mode, "case_opened", {}); }
    }

    const { data: cases } = await db.from("onboarding_cases").select("*").eq("mode", mode).eq("status", "active").order("opened_at").limit(MAX_CASES);
    for (const k of cases ?? []) {
      try { await work(k, mode, cfg, summary); }
      catch (e) { summary.errors.push(`${k.household_id}: ${e instanceof Error ? e.message : String(e)}`); }
    }
    if (summary.errors.length) {
      await logSystemHealth(db as any, { function_name: "onboarding-agent-tick", severity: "WARN", error_code: "ONBOARDING_AGENT_PARTIAL", error_message: summary.errors.join("; ").slice(0, 900) });
    }
    return json({ ok: true, mode, ...summary });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await logSystemHealth(db as any, { function_name: "onboarding-agent-tick", severity: "ERROR", error_code: "ONBOARDING_AGENT_FAILED", error_message: message.slice(0, 900) });
    return json({ error: message }, 500);
  }
});

async function event(householdId: string, caseId: string | null, mode: string, kind: string, detail: Record<string, unknown>) {
  await db.from("onboarding_agent_events").insert({ household_id: householdId, case_id: caseId, mode, kind, detail });
}

async function work(k: any, mode: "shadow" | "live", cfg: AgentConfig, summary: Record<string, number> & { errors: string[] }) {
  const now = Date.now();
  const { data: hh } = await db.from("households").select("id, label, family_id, created_at, vault_root_folder_id, audit_booked_at, profile_completed_at, wealth_event_completed_at, household_context_completed_at").eq("id", k.household_id).maybeSingle();
  if (!hh) return;
  const { data: head } = await db.from("contacts").select("id, first_name, email, family_role").eq("household_id", hh.id).order("family_role").limit(5);
  const lead = (head ?? []).find((p: any) => p.family_role === "head_of_family") ?? (head ?? [])[0] ?? null;
  const memberIds = (head ?? []).map((p: any) => p.id);

  const { data: files } = await db.from("vault_files").select("created_at, uploaded_by_contact_id, contact_id").eq("household_id", hh.id).eq("is_folder", false);
  const clientFiles = (files ?? []).filter((f: any) => f.uploaded_by_contact_id || (f.contact_id && memberIds.includes(f.contact_id)));
  const lastUpload = clientFiles.reduce((m: number, f: any) => Math.max(m, Date.parse(f.created_at)), 0);
  const { count: openRequests } = memberIds.length
    ? await db.from("portal_requests").select("id", { count: "exact", head: true }).in("contact_id", memberIds).is("resolved_at", null)
    : { count: 0 };

  const activity = Math.max(lastUpload, ms(hh.audit_booked_at) ?? 0, ms(hh.profile_completed_at) ?? 0, ms(hh.wealth_event_completed_at) ?? 0, ms(hh.household_context_completed_at) ?? 0);
  const facts: CaseFacts = {
    now, status: k.status, enrolledAt: Date.parse(hh.created_at), openedAt: Date.parse(k.opened_at),
    surveyBooked: !!hh.audit_booked_at, docsReceived: clientFiles.length > 0, vaultProvisioned: !!hh.vault_root_folder_id, vaultRetries: k.vault_retries,
    hasEmail: !!lead?.email, openPortalRequest: (openRequests ?? 0) > 0, lastClientActivityAt: activity || null,
    nudgeCount: k.nudge_count, lastNudgeAt: ms(k.last_nudge_at), snoozedUntil: ms(k.snoozed_until),
  };
  // Live cases keep their checklist up to date, whatever the decision is.
  let ids: Record<string, string> = (k.checklist ?? {}) as Record<string, string>;
  if (mode === "live") {
    ids = await ensureChecklist(k, hh, lead?.id ?? null);
    await syncChecklist(k, ids, facts);
  }
  // Has the client (or a person at the firm) answered a reminder? Georgia never writes back: she pauses, or hands it to a person.
  if (mode === "live" && (k.thread_ids ?? []).length) {
    const handled = await handleReplies(k, hh, lead, facts, ids, summary);
    if (handled) return;
  }
  const d: Decision = decideNext(facts, cfg);
  summary.evaluated++;
  if (d.kind === "wait") { summary.waiting++; return; }

  const touch = (patch: Record<string, unknown>) => db.from("onboarding_cases").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", k.id);
  const snapshot = { surveyBooked: facts.surveyBooked, docsReceived: facts.docsReceived, nudgesSent: k.nudge_count };

  if (d.kind === "complete") {
    await touch({ status: "complete", completed_at: new Date().toISOString() });
    await event(hh.id, k.id, mode, "complete", snapshot);
    if (mode === "live" && ids.parent) {
      await db.from("pm_tasks").update({ status: "done", completed_at: new Date().toISOString() }).eq("id", ids.parent);
      await comment(ids.parent, COMPLETE_COMMENT);
    }
    summary.complete++;
    return;
  }

  if (d.kind === "nudge") {
    if (mode === "live") {
      const { subject, html } = nudgeEmail(lead?.first_name || "there", d.step);
      const sent = await sendServiceEmailDetailed(db, { to: lead!.email, subject, html, from: Deno.env.get("ONBOARDING_AGENT_FROM") || AGENT_SENDER });
      if (!sent.ok) { await event(hh.id, k.id, mode, "nudge_failed", { step: d.step }); summary.errors.push(`${hh.id}: email failed`); return; }
      if (sent.threadId) {
        await touch({
          thread_ids: [...new Set([...(k.thread_ids ?? []), sent.threadId])].slice(-6),
          sent_message_ids: [...(k.sent_message_ids ?? []), ...(sent.messageId ? [sent.messageId] : [])].slice(-20),
        });
      }
    }
    await touch({ nudge_count: nextNudgeCount(facts), last_nudge_at: new Date().toISOString() });
    await event(hh.id, k.id, mode, mode === "live" ? "nudge_sent" : "nudge_would_send", { step: d.step, ...snapshot });
    if (mode === "live") await comment(ids.parent, NUDGE_COMMENT(nextNudgeCount(facts), d.step));
    summary.nudges++;
    return;
  }

  if (d.kind === "retry_vault") {
    if (mode === "live") {
      const r = await provisionClientFolderTree(db, hh.id, "onboarding_agent");
      await event(hh.id, k.id, mode, r.ok ? "vault_retry_ok" : "vault_retry_failed", { error: r.ok ? undefined : r.error });
    } else await event(hh.id, k.id, mode, "vault_retry_would_run", {});
    await touch({ vault_retries: k.vault_retries + 1 });
    summary.vaultRetries++;
    return;
  }

  // escalate
  await escalateCase(k, hh, lead, facts, mode, ids, d.reason, d.detail, undefined);
  summary.escalations++;
}

/** Hands a case to a person: a task for Rolf and a notification (live), and Georgia stops. */
async function escalateCase(k: any, hh: any, lead: any, facts: CaseFacts, mode: "shadow" | "live", ids: Record<string, string>, reason: any, detail: string, replyPreview: string | undefined) {
  const snapshot = { surveyBooked: facts.surveyBooked, docsReceived: facts.docsReceived, nudgesSent: k.nudge_count };
  let taskId: string | null = null;
  if (mode === "live") {
    const { data: rolf } = await db.from("profiles").select("user_id").eq("email", ESCALATION_ASSIGNEE_EMAIL).maybeSingle();
    if (rolf?.user_id) {
      const { data: task } = await db.from("pm_tasks").insert({
        title: ESCALATION_TITLE(hh.label ?? "household"), status: "open", client_visible: false, assignee_id: rolf.user_id, created_by: rolf.user_id,
        household_id: hh.id, family_id: hh.family_id ?? null, contact_id: lead?.id ?? null,
        description: escalationBody({ reason, detail, label: hh.label ?? "household", surveyBooked: facts.surveyBooked, docsReceived: facts.docsReceived, nudges: k.nudge_count, enrolledAt: facts.enrolledAt, now: Date.now(), replyPreview }),
      }).select("id").maybeSingle();
      taskId = task?.id ?? null;
    }
    await db.from("staff_notifications").insert({
      title: ESCALATION_TITLE(hh.label ?? "household"), body: detail, link: `/households/${hh.id}`, contact_id: lead?.id ?? null, source_type: "onboarding_agent",
    });
  }
  await db.from("onboarding_cases").update({ status: "escalated", escalated_at: new Date().toISOString(), escalation_reason: reason, escalation_task_id: taskId, updated_at: new Date().toISOString() }).eq("id", k.id);
  await event(hh.id, k.id, mode, mode === "live" ? "escalated" : "would_escalate", { reason, detail, taskId, ...snapshot });
  if (mode === "live") await comment(ids.parent, ESCALATED_COMMENT(detail));
}

/** Looks for replies in the case's Gmail threads. Returns true when it acted (so the normal decision is skipped this tick). */
async function handleReplies(k: any, hh: any, lead: any, facts: CaseFacts, ids: Record<string, string>, summary: Record<string, number> & { errors: string[] }): Promise<boolean> {
  const token = await getServiceGoogleAccessToken(db);
  const messages = (await Promise.all((k.thread_ids as string[]).map((t) => fetchThread(token, t)))).flat();
  const { client, staff } = inboundReplies(messages, { sentIds: k.sent_message_ids ?? [], handledIds: k.handled_message_ids ?? [] });
  const touch = (patch: Record<string, unknown>) => db.from("onboarding_cases").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", k.id);
  const handledIds = [...(k.handled_message_ids ?? [])];

  // A person at the firm replied to the client in the thread: they are on it, so Georgia waits.
  if (staff.length && !client.length) {
    await touch({ handled_message_ids: [...handledIds, ...staff.map((m) => m.id)].slice(-50), snoozed_until: new Date(Date.now() + SNOOZE_DAYS_STAFF * 86_400_000).toISOString() });
    await event(hh.id, k.id, "live", "staff_replied", { waitDays: SNOOZE_DAYS_STAFF });
    summary.waiting++;
    return true;
  }
  if (!client.length) return false;

  const reply = client[0];
  const text = cleanReply(reply.text);
  const names = [lead?.first_name, hh.label].filter(Boolean) as string[];
  const triaged = await triageReply(text, names);
  if (triaged.failed) summary.errors.push(`${hh.id}: reply classification failed: ${triaged.failed}`);
  const intent: string = triaged.intent;
  const blurb = triaged.summary;
  const action = replyAction(intent as any, text);
  await event(hh.id, k.id, "live", "reply_received", { intent, summary: blurb, messageId: reply.id });
  await touch({ handled_message_ids: [...handledIds, reply.id].slice(-50) });
  if (action.kind === "snooze") {
    await touch({ snoozed_until: new Date(Date.now() + action.days * 86_400_000).toISOString() });
    await event(hh.id, k.id, "live", "reply_snoozed", { waitDays: action.days });
    summary.waiting++;
    return true;
  }
  const detail = action.reason === "asked_to_stop" ? "The client asked us to stop emailing them." : `The client replied to a reminder${blurb ? `: ${blurb}` : "."}`;
  await escalateCase(k, hh, lead, facts, "live", ids, action.reason, detail, text || "(no readable text)");
  summary.escalations++;
  return true;
}


// ───── Checklist tasks (live mode only) ─────
async function rolfId(): Promise<string | null> {
  const { data } = await db.from("profiles").select("user_id").eq("email", ESCALATION_ASSIGNEE_EMAIL).maybeSingle();
  return data?.user_id ?? null;
}

async function comment(taskId: string | undefined, body: string) {
  if (taskId) await db.from("pm_task_comments").insert({ task_id: taskId, author_agent_key: CONCIERGE_KEY, body });
}

/** Creates the parent task and one subtask per checklist item the first time; returns the ids ({ parent, vault, survey, documents }). */
async function ensureChecklist(k: any, hh: any, leadId: string | null): Promise<Record<string, string>> {
  const existing = (k.checklist ?? {}) as Record<string, string>;
  if (existing.parent) return existing;
  const owner = await rolfId();
  if (!owner) return existing;
  const base = { status: "open", client_visible: false, assigned_agent_key: CONCIERGE_KEY, created_by: owner, household_id: hh.id, family_id: hh.family_id ?? null, contact_id: leadId };
  const { data: parent } = await db.from("pm_tasks").insert({ ...base, title: parentTitle(hh.label ?? "household"), description: "Georgia, AI Assistant manages this client's onboarding. It is complete when the Survey Session is booked and documents have been received. Georgia hands the case to a person only if something needs one." }).select("id").maybeSingle();
  if (!parent?.id) return existing;
  const ids: Record<string, string> = { parent: parent.id };
  for (const item of CHECKLIST) {
    const { data: sub } = await db.from("pm_tasks").insert({ ...base, parent_task_id: parent.id, title: item.title }).select("id").maybeSingle();
    if (sub?.id) ids[item.key] = sub.id;
  }
  await db.from("onboarding_cases").update({ checklist: ids }).eq("id", k.id);
  return ids;
}

/** Marks checklist subtasks done as the milestones are reached. */
async function syncChecklist(k: any, ids: Record<string, string>, facts: CaseFacts) {
  if (!ids.parent) return;
  const done: ChecklistKey[] = (ids.done ? String(ids.done).split(",") : []) as ChecklistKey[];
  const fresh = newlyDone(progressFrom(facts), done);
  if (!fresh.length) return;
  const now = new Date().toISOString();
  for (const key of fresh) if (ids[key]) await db.from("pm_tasks").update({ status: "done", completed_at: now }).eq("id", ids[key]);
  await db.from("onboarding_cases").update({ checklist: { ...ids, done: [...done, ...fresh].join(",") } }).eq("id", k.id);
}
