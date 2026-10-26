// notice-service.ts: Georgia handles iA and Adobe Sign notices as they arrive, without asking. For each new notice she finds the client's matching
// open task, comments on it (the client sees the comment if the task is shared with them), closes it when the notice clearly completes the work,
// and files the email. Anything uncertain, or about a problem, is left alone and flagged for the morning meeting. The rules are in notice-rules.ts.

// deno-lint-ignore-file no-explicit-any
import "./bc-time.ts";
import { ADMIN_INBOX_EMAIL, getValidGoogleAccessToken, resolveUserIdByEmail } from "./google-token.ts";
import { classifyEmail } from "./briefing-facts.ts";
import { emailText } from "./ea-agent.ts";
import { GEMINI_EXTRACT_MODEL, generateVertexContent, parseServiceAccountKey, withThinking } from "./vertex-ai.ts";
import { NOTICE_TOOL, candidatePeople, decide, mayAutoClose, noticeCompletes, noticePrompt, type NoticeKind } from "./notice-rules.ts";
import { appendNote, noteLine } from "./georgia-tasks.ts";
import { postTaskEvent } from "./task-events.ts";
import { maybeCreateMeetingRecord } from "./meeting-record-service.ts";
import { notifyClientsOfComment, notifyProsOfComment } from "./task-notify.ts";
import { GMAIL_MODIFY_SCOPE, gmailFor, handledLabelId, withConversationSiblings } from "./gmail-handled.ts";
import { isOn } from "./georgia-switches.ts";

const MAX_PER_RUN = 8;
const zone = "America/Vancouver";
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: zone }).format(new Date());
const header = (headers: any[], name: string) => headers?.find((h: any) => h.name?.toLowerCase() === name.toLowerCase())?.value || "";
const REQUESTED = /\b(signature requested|reminder|please sign|waiting for your signature|awaiting)\b/i;
const PROBLEM = /\b(requested|missing|rejected|declined|outstanding|not received|incomplete|error|failed|cancel+ed|expired|action required|additional information)\b/i;

export async function runNoticeProcessor(db: any): Promise<string[]> {
  const out: string[] = [];
  if (!(await isOn(db, "notice_processor"))) return ["switched off"];
  const rolfId = await resolveUserIdByEmail(db, ADMIN_INBOX_EMAIL);
  const token = await getValidGoogleAccessToken(db, rolfId);
  const auth = { headers: { Authorization: `Bearer ${token}` } };
  const list = async (q: string) => {
    const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?` + new URLSearchParams({ q, maxResults: "40" }), auth);
    if (!r.ok) throw new Error(`Gmail list error: ${r.status}`);
    return ((await r.json()).messages || []) as { id: string }[];
  };
  const [inbox, admin] = await Promise.all([list("in:inbox newer_than:2d"), list("to:admin@prosperwise.ca newer_than:2d in:anywhere")]);
  const ids = [...new Set([...inbox, ...admin].map((m) => m.id))];
  if (!ids.length) return out;
  const { data: seenRows } = await db.from("notice_seen").select("message_id").in("message_id", ids);
  const seen = new Set((seenRows ?? []).map((r: any) => r.message_id));
  const fresh = ids.filter((id) => !seen.has(id));
  if (!fresh.length) return out;

  const metas = await Promise.all(fresh.map(async (id) => {
    const params = new URLSearchParams({ format: "metadata" });
    for (const h of ["Subject", "From", "List-Unsubscribe"]) params.append("metadataHeaders", h);
    const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?${params}`, auth);
    return r.ok ? await r.json() : null;
  }));
  const notices = metas.filter(Boolean).map((m: any) => {
    const e = { from: header(m.payload?.headers, "From"), subject: header(m.payload?.headers, "Subject") || "(no subject)", snippet: String(m.snippet || ""), labels: m.labelIds || [], bulk: !!header(m.payload?.headers, "List-Unsubscribe") };
    return { id: m.id as string, ...e, kind: classifyEmail(e) };
  }).filter((n) => n.kind === "ia_notice" || n.kind === "adobe_sign").slice(0, MAX_PER_RUN);
  if (!notices.length) return out;

  const { data: people } = await db.from("contacts").select("id, first_name, last_name, household_id, family_id").limit(10000);
  const sa = await parseServiceAccountKey(Deno.env.get("GCP_SERVICE_ACCOUNT_KEY"));
  const { data: tok } = await db.from("google_tokens").select("scopes").eq("user_id", rolfId).maybeSingle();
  const canFile = ((tok?.scopes ?? []) as string[]).includes(GMAIL_MODIFY_SCOPE);
  const gm = gmailFor(token);
  const date = today();
  const url = Deno.env.get("SUPABASE_URL")!, key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const filed: string[] = [];

  const record = (kind: string, status: "done" | "proposed", summary: string, payload: Record<string, unknown>) =>
    db.from("ea_actions").insert({ staff_user_id: rolfId, conversation_date: date, kind, status, summary: summary.slice(0, 300), payload });
  const flag = async (n: any, why: string, extra: Record<string, unknown> = {}) => {
    await record("notice_flagged", "proposed", `${n.kind === "adobe_sign" ? "Adobe Sign" : "iA"}: "${n.subject.slice(0, 90)}". ${why}`, { message_id: n.id, ...extra });
    await db.from("staff_notifications").insert({ title: "Georgia has a notice for you", body: `${n.subject.slice(0, 120)}. ${why}`.slice(0, 240), link: "/ask-georgia", source_type: "georgia_notice" });
    await db.from("notice_seen").upsert({ message_id: n.id, outcome: "flagged" }, { onConflict: "message_id" });
    out.push(`flagged: ${n.subject.slice(0, 60)}`);
  };

  for (const n of notices) {
    try {
      const kind = n.kind as NoticeKind;
      if (kind === "adobe_sign" && REQUESTED.test(n.subject) && !noticeCompletes(kind, n.subject, "")) { await db.from("notice_seen").upsert({ message_id: n.id, outcome: "skipped" }, { onConflict: "message_id" }); continue; }
      const full = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${n.id}?format=full`, auth);
      const body = full.ok ? emailText((await full.json()).payload, 4000) : n.snippet;
      if (kind === "ia_notice" && PROBLEM.test(n.subject) && !noticeCompletes(kind, n.subject, "")) { await flag(n, "It reports a problem or asks for something, so it needs you."); continue; }

      const named = candidatePeople(`${n.subject}\n${body}`, (people ?? []) as any[]);
      if (!named.length) { await flag(n, "I could not tell which client it is about."); continue; }
      const personIds = named.map((p) => p.id), householdIds = [...new Set(named.map((p: any) => p.household_id).filter(Boolean))];
      const filter = [`contact_id.in.(${personIds.join(",")})`, ...(householdIds.length ? [`household_id.in.(${householdIds.join(",")})`] : [])].join(",");
      const { data: tasks } = await db.from("pm_tasks").select("id, title, status, client_visible, contact_id, household_id, parent_task_id, recurrence, staff_notes").neq("status", "done").or(filter).limit(30);
      const open = (tasks ?? []) as any[];
      if (!open.length) { await flag(n, `${named[0].first_name} ${named[0].last_name} has no open task for it.`); continue; }
      const subOf = (id: string) => open.filter((t) => t.parent_task_id === id);

      const prompt = noticePrompt({ kind, subject: n.subject, from: n.from, body, client: named.map((p) => `${p.first_name} ${p.last_name}`).join(" / "), tasks: open.map((t) => ({ id: t.id, title: t.title, status: t.status, subtasks: subOf(t.id).map((s) => s.title) })) });
      const result = await generateVertexContent(sa, GEMINI_EXTRACT_MODEL, [{ role: "user", parts: [{ text: prompt }] }], withThinking(GEMINI_EXTRACT_MODEL, { temperature: 0.1, maxOutputTokens: 1024 }, "low"), { tools: [{ functionDeclarations: [NOTICE_TOOL] }], toolConfig: { functionCallingConfig: { mode: "ANY", allowedFunctionNames: ["decide_notice"] } } });
      const call = (result.candidates?.[0]?.content?.parts || []).find((p: any) => p.functionCall)?.functionCall;
      const d: any = call?.args;
      if (!d) { await flag(n, "I could not make sense of it."); continue; }

      const task = open.find((t) => t.id === d.task_id);
      const closeOk = !!task && mayAutoClose({ kind, subject: n.subject, body, taskTitle: task.title, recurrence: task.recurrence, openSubtasks: subOf(task.id).length });
      const action = decide(d, open.map((t) => t.id), closeOk);
      if (action.act === "flag" || !task) { await flag(n, action.act === "flag" ? action.why : "No matching task.", { candidates: open.slice(0, 5).map((t) => t.title) }); continue; }

      const said = String(d.what_happened || "").slice(0, 300);
      const comment = task.client_visible ? String(d.client_update || said).slice(0, 600) : `Georgia: ${said}`;
      const { data: dupe } = await db.from("pm_task_comments").select("id").eq("task_id", task.id).eq("author_agent_key", "georgia").eq("body", comment).limit(1);
      if (!(dupe ?? []).length) {
        await db.from("pm_task_comments").insert({ task_id: task.id, author_agent_key: "georgia", body: comment, body_format: "text" });
        await Promise.all([notifyClientsOfComment(db, task, url, key), notifyProsOfComment(db, task, url, key, Deno.env.get("INTERNAL_FUNCTION_SECRET") ?? "")]);
      }
      const closing = action.act === "close";
      await db.from("pm_tasks").update({ staff_notes: appendNote(task.staff_notes, noteLine(date, `${n.kind === "adobe_sign" ? "Adobe Sign" : "iA"} notice: ${said}${closing ? " Closed because the notice says the work is finished." : ""}`)), ...(closing ? { status: "done", completed_at: new Date().toISOString() } : {}) }).eq("id", task.id);
      if (closing) { await postTaskEvent(db, task, "completed", { label: "Georgia", agentKey: "georgia" }); await maybeCreateMeetingRecord(db, task.id); }
      await record("notice_handled", "done", `${n.kind === "adobe_sign" ? "Adobe Sign" : "iA"}: ${said} ${closing ? "Commented on and closed" : "Commented on"} "${task.title}"${task.client_visible ? " (client told in their portal)" : ""}.`, { message_id: n.id, task_id: task.id, closed: closing, client_told: !!task.client_visible });
      await db.from("notice_seen").upsert({ message_id: n.id, outcome: closing ? "closed" : "commented", task_id: task.id }, { onConflict: "message_id" });
      filed.push(n.id);
      out.push(`${closing ? "closed" : "commented"}: ${task.title.slice(0, 60)}`);
    } catch (e) {
      console.error("[notice-processor]", n.subject, e);
      await flag(n, "Something went wrong while I handled it, so I left it for you.");
    }
  }

  if (filed.length && canFile) {
    try {
      const label = await handledLabelId(gm);
      if (label && (await gm("messages/batchModify", { method: "POST", body: JSON.stringify({ ids: await withConversationSiblings(gm, filed), addLabelIds: [label], removeLabelIds: ["INBOX", "UNREAD"] }) })).ok) {
        await record("emails_filed", "done", `Filed ${filed.length} notice${filed.length === 1 ? "" : "s"} after handling them`, { ids: filed, label_id: label });
      }
    } catch (e) { console.error("[notice-processor] filing", e); }
  }
  return out;
}
