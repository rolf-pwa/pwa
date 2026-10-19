// task-recurrence.ts: when a repeating task is completed, the next one is made. Idempotent: a task makes at most one next task.

// deno-lint-ignore-file no-explicit-any
import { nextOccurrence, validRecurrence } from "./georgia-tasks.ts";
import { pacificYmd } from "./meeting-record.ts";

/** Makes the next task of a repeating series after `taskId` was completed. Returns the new task's id, or null when there is nothing to make. */
export async function maybeCreateNextRecurrence(db: any, taskId: string): Promise<string | null> {
  try {
    const { data: t } = await db.from("pm_tasks").select("id, title, description, status, due_date, completed_at, parent_task_id, contact_id, household_id, family_id, client_visible, created_by, assignee_id, recurrence").eq("id", taskId).maybeSingle();
    const rec = validRecurrence(t?.recurrence);
    if (!t || t.status !== "done" || t.parent_task_id || !rec) return null;
    const today = pacificYmd(new Date().toISOString());
    let next = nextOccurrence(t.due_date ?? pacificYmd(t.completed_at ?? new Date().toISOString()), rec);
    for (let i = 0; i < 60 && next <= today; i++) next = nextOccurrence(next, rec); // a very late completion does not leave the next one already overdue
    const toGeorgia = rec.owner !== "same";
    const { data: made, error } = await db.from("pm_tasks").insert({
      title: t.title, description: t.description, status: "open", due_date: next, contact_id: t.contact_id, household_id: t.household_id, family_id: t.family_id,
      client_visible: t.client_visible, created_by: t.created_by, recurrence: t.recurrence, recurred_from: t.id,
      assigned_agent_key: toGeorgia ? "georgia" : null, assignee_id: toGeorgia ? null : t.assignee_id,
    }).select("id").maybeSingle();
    if (error) { if (!/duplicate|unique/i.test(error.message)) console.error("[recurrence] could not make the next task", error.message); return null; }
    await db.from("staff_notifications").insert({ title: `Next "${t.title}" is set for ${next}`, body: toGeorgia ? "Georgia will watch it and hand it to you ahead of the date." : "Assigned to the same person.", link: t.contact_id ? `/contacts/${t.contact_id}` : null, contact_id: t.contact_id, source_type: "task_recurrence" });
    return made?.id ?? null;
  } catch (e) {
    console.error("[recurrence] failed", e instanceof Error ? e.message : e);
    return null;
  }
}
