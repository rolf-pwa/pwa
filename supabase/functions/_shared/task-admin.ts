// task-admin.ts: deleting a task and sharing it with the client, in one place so the Tasks page and Georgia do exactly the same thing.
import { deleteBlocker } from "./task-delete.ts";
import { postTaskNote, releasedText } from "./task-events.ts";
import { notifyClientsOfComment } from "./task-notify.ts";

// deno-lint-ignore no-explicit-any
type Db = any;

export const TASK_FIELDS =
  "id, project_id, parent_task_id, title, description, status, due_date, assignee_id, assigned_agent_key, household_id, contact_id, corporation_id, family_id, completed_at, client_visible, meeting_followup, meeting_event, staff_notes, recurrence, created_by, created_at, updated_at";

export type TaskDeleteResult = { ok: true; title: string; subtasks: number } | { ok: false; status: number; error: string };

/**
 * Deletes a task and its action items, after keeping a copy (the task, its action items and comments) in pm_task_deletions. Refused when the task is
 * part of the record: a filed meeting record, or anything a client or professional wrote. `via` says who asked ("georgia" when she did).
 */
export async function deleteTaskSafely(db: Db, id: string, userId: string | null, via: "staff" | "georgia" = "staff"): Promise<TaskDeleteResult> {
  const { data: task } = await db.from("pm_tasks").select(TASK_FIELDS).eq("id", id).maybeSingle();
  if (!task) return { ok: false, status: 404, error: "Task not found" };
  const { data: subs } = await db.from("pm_tasks").select(TASK_FIELDS).eq("parent_task_id", id);
  const ids = [id, ...(subs ?? []).map((s: { id: string }) => s.id)];
  const [{ data: comments }, { data: records }] = await Promise.all([
    db.from("pm_task_comments").select("*").in("task_id", ids),
    db.from("meeting_records").select("task_id").in("task_id", ids),
  ]);
  const blocker = deleteBlocker({
    hasMeetingRecord: (records ?? []).length > 0,
    // deno-lint-ignore no-explicit-any
    clientComments: (comments ?? []).filter((c: any) => c.author_contact_id).length,
    // deno-lint-ignore no-explicit-any
    professionalComments: (comments ?? []).filter((c: any) => c.author_professional_id).length,
  });
  if (blocker) return { ok: false, status: 409, error: blocker };
  const { error: auditErr } = await db.from("pm_task_deletions").insert({
    task_id: id, title: task.title, contact_id: task.contact_id, household_id: task.household_id,
    snapshot: { task, subtasks: subs ?? [], comments: comments ?? [], via }, deleted_by: userId,
  });
  if (auditErr) return { ok: false, status: 500, error: "Could not keep a copy, so nothing was deleted." };
  const { error } = await db.from("pm_tasks").delete().eq("id", id);
  if (error) return { ok: false, status: 500, error: error.message };
  return { ok: true, title: task.title, subtasks: (subs ?? []).length };
}

/**
 * Sharing a task with the client is the release: it is noted in the thread, and the client is told (portal bell, and the short email). Only a task
 * of its own (not an action item) is released. Hiding it again just turns it off. Returns whether the client was told.
 */
export async function setTaskClientVisible(
  db: Db, task: { id: string; title: string; parent_task_id?: string | null; client_visible: boolean | null; contact_id?: string | null; household_id?: string | null },
  visible: boolean, actor: { label: string; userId?: string | null; agentKey?: string | null },
): Promise<{ changed: boolean; told: boolean }> {
  if (!!task.client_visible === visible) return { changed: false, told: false };
  const { error } = await db.from("pm_tasks").update({ client_visible: visible }).eq("id", task.id);
  if (error) throw new Error(error.message);
  if (!visible || task.parent_task_id) return { changed: true, told: false };
  await postTaskNote(db, task.id, releasedText(actor.label), actor);
  // @ts-ignore EdgeRuntime is provided by Supabase Edge Functions runtime
  EdgeRuntime.waitUntil(notifyClientsOfComment(db, { id: task.id, title: task.title, client_visible: true, contact_id: task.contact_id ?? null, household_id: task.household_id ?? null }, Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, "updated"));
  return { changed: true, told: true };
}
