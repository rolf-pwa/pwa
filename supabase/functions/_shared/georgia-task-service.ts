// georgia-task-service.ts: Georgia works the tasks assigned to her.
//   - A repeating task is only watched. Ahead of its date she hands it to Rolf with a note; he does it.
//   - Any other task she works with her morning-meeting tools (research, mail and calendar search, households and Vaults, hidden tasks, drafts that wait
//     for Rolf). She cannot contact a client, comment on a client's task, send, delete, pay or book. When she finishes she either closes a simple
//     task or hands it back to Rolf; money and client messages always go back to him (enforced here, whatever she says).
// Her notes go to the task's staff-only notes and to an in-app note for Rolf, never into a comment a client could see.

// deno-lint-ignore-file no-explicit-any
import { ADMIN_INBOX_EMAIL, resolveUserIdByEmail } from "./google-token.ts";
import { parseServiceAccountKey } from "./vertex-ai.ts";
import { buildEaTools, callGemini } from "./ea-handlers.ts";
import { SYSTEM_PROMPT, TOOL_DECLARATIONS, runAgentTurn } from "./ea-agent.ts";
import { BLOCKED_WHEN_WORKING_ALONE, FINISH_TOOL, MAX_ATTEMPTS, WORK_MODE_PROMPT, appendNote, decideOutcome, isReady, noteLine, type Outcome } from "./georgia-tasks.ts";
import { postTaskEvent } from "./task-events.ts";
import { maybeCreateMeetingRecord } from "./meeting-record-service.ts";
import { maybeCreateNextRecurrence } from "./task-recurrence.ts";
import { pacificYmd } from "./meeting-record.ts";

const FIELDS = "id, title, description, status, due_date, contact_id, household_id, family_id, client_visible, parent_task_id, recurrence, staff_notes, agent_attempts";

const plain = (html: string): string => String(html ?? "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

async function tell(db: any, title: string, body: string, contactId: string | null) {
  await db.from("staff_notifications").insert({ title: title.slice(0, 200), body: body.slice(0, 240), link: contactId ? `/contacts/${contactId}` : null, contact_id: contactId, source_type: "georgia_task" });
}

/** Hands a task to Rolf: it leaves her queue and appears in his tasks, with her note. */
async function handBack(db: any, task: any, rolfId: string, today: string, note: string) {
  await db.from("pm_tasks").update({ assignee_id: rolfId, assigned_agent_key: null, staff_notes: appendNote(task.staff_notes, noteLine(today, note)) }).eq("id", task.id);
}

async function finishDone(db: any, task: any, today: string, note: string) {
  await db.from("pm_tasks").update({ status: "done", completed_at: new Date().toISOString(), staff_notes: appendNote(task.staff_notes, noteLine(today, note)) }).eq("id", task.id);
  await postTaskEvent(db, task, "completed", { label: "Georgia", agentKey: "georgia" });
  await maybeCreateMeetingRecord(db, task.id);
  await maybeCreateNextRecurrence(db, task.id);
}

async function workTask(db: any, task: any, rolfId: string, today: string) {
  const sa = await parseServiceAccountKey(Deno.env.get("GCP_SERVICE_ACCOUNT_KEY"));
  const tools = buildEaTools(db, rolfId, today, sa);
  let finish: { outcome: Outcome | null; summary: string } | null = null;

  const [{ data: client }, { data: comments }, { data: subs }] = await Promise.all([
    task.contact_id ? db.from("contacts").select("full_name").eq("id", task.contact_id).maybeSingle() : Promise.resolve({ data: null }),
    db.from("pm_task_comments").select("body, author_contact_id, kind, created_at").eq("task_id", task.id).order("created_at", { ascending: false }).limit(10),
    db.from("pm_tasks").select("title, status").eq("parent_task_id", task.id).order("created_at"),
  ]);
  const context = [
    `Today is ${today}.`,
    `TASK: ${task.title}`,
    `Due: ${task.due_date ?? "no date"}. ${task.client_visible ? "The client can see this task." : "The client cannot see this task."}`,
    client?.full_name ? `Client: ${client.full_name}` : "",
    task.description ? `Details: ${plain(task.description)}` : "",
    task.staff_notes ? `Earlier notes on it (staff only):\n${task.staff_notes}` : "",
    (subs ?? []).length ? `Subtasks: ${(subs ?? []).map((s: any) => `${s.title} (${s.status})`).join("; ")}` : "",
    (comments ?? []).length ? `Recent comments, newest first:\n${(comments ?? []).filter((c: any) => c.kind !== "system").map((c: any) => `- ${c.author_contact_id ? "Client" : "Staff"}: ${plain(c.body).slice(0, 300)}`).join("\n")}` : "",
  ].filter(Boolean).join("\n");

  const declarations = [...TOOL_DECLARATIONS.filter((t) => !BLOCKED_WHEN_WORKING_ALONE.includes(t.name)), FINISH_TOOL];
  const runTool = async (name: string, a: Record<string, unknown>) => {
    if (name === "finish_task") {
      const said = String(a.outcome).toLowerCase() === "done" ? "done" : "needs_rolf";
      finish = { outcome: said as Outcome, summary: String(a.summary ?? "").slice(0, 800) };
      return { ok: true, message: "Noted." };
    }
    if (BLOCKED_WHEN_WORKING_ALONE.includes(name)) return { ok: false, message: "I may not do that on my own: it is for Rolf." };
    return tools.runTool(name, a);
  };
  const system = `${SYSTEM_PROMPT}\n\n${WORK_MODE_PROMPT}\n\n${context}`;
  const result = await runAgentTurn([{ role: "user", parts: [{ text: "Work on this task now." }] }], { callModel: (contents) => callGemini(sa, system, contents, declarations), runTool });

  const fin = finish as { outcome: Outcome | null; summary: string } | null;
  const summary = fin?.summary || result.text || "I looked at this but have nothing to report.";
  const outcome = decideOutcome(fin?.outcome ?? null, task.title, task.description);
  if (outcome === "done") {
    await finishDone(db, task, today, `Closed. ${summary}`);
    await tell(db, `Georgia finished: ${task.title}`, summary, task.contact_id ?? null);
  } else {
    await handBack(db, task, rolfId, today, summary);
    await tell(db, `Georgia handed back: ${task.title}`, summary, task.contact_id ?? null);
  }
  return outcome;
}

/** One task: a repeating one is handed to Rolf ahead of its date; any other is worked. */
export async function handleGeorgiaTask(db: any, task: any, rolfId: string, today: string): Promise<string> {
  if (task.recurrence) {
    await handBack(db, task, rolfId, today, `Coming up on ${task.due_date}. Over to you.`);
    await tell(db, `Coming up: ${task.title}`, `Due ${task.due_date}. Georgia has handed it to you.`, task.contact_id ?? null);
    return "handed to Rolf (repeating)";
  }
  const attempts = (task.agent_attempts ?? 0) + 1;
  await db.from("pm_tasks").update({ agent_attempts: attempts }).eq("id", task.id);
  try {
    return await workTask(db, task, rolfId, today);
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    console.error("[georgia-tasks] failed", task.title, reason);
    if (attempts >= MAX_ATTEMPTS) {
      await handBack(db, task, rolfId, today, `I could not work on this (${reason}). Over to you.`);
      await tell(db, `Georgia could not do: ${task.title}`, reason, task.contact_id ?? null);
      return "handed to Rolf (failed)";
    }
    return "failed, will retry";
  }
}

/** The 15-minute pass: the tasks assigned to Georgia that are due her attention, a couple at a time. */
export async function runGeorgiaTasks(db: any, opts: { limit?: number } = {}): Promise<string[]> {
  const today = pacificYmd(new Date().toISOString());
  const { data } = await db.from("pm_tasks").select(FIELDS).eq("assigned_agent_key", "georgia").neq("status", "done").order("due_date", { ascending: true, nullsFirst: true }).limit(40);
  const ready = (data ?? []).filter((t: any) => isReady(t.due_date, today)).slice(0, opts.limit ?? 2);
  if (!ready.length) return [];
  const rolfId = await resolveUserIdByEmail(db, ADMIN_INBOX_EMAIL);
  const out: string[] = [];
  for (const t of ready) out.push(`${t.title}: ${await handleGeorgiaTask(db, t, rolfId, today)}`);
  return out;
}
