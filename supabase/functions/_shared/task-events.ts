// task-events.ts: the system line added to a task's thread when it, or one of its action items, is completed or reopened.
// The time is the comment's own created_at, so the thread and the meeting record show it the same way.

// deno-lint-ignore-file no-explicit-any

export type TaskEvent = "completed" | "reopened";
export interface Actor { label: string; userId?: string | null; professionalId?: string | null; agentKey?: string | null }

/** "Task completed by Rolf Issler", or for an action item "Action item completed by Rolf Issler: Request Policy Loan". */
export function taskEventText(event: TaskEvent, actor: string, itemTitle: string | null): string {
  return itemTitle ? `Action item ${event} by ${actor}: ${itemTitle}` : `Task ${event} by ${actor}`;
}

/** Whether a status change is a completion or a reopening (and nothing else, such as open to in progress). */
export function eventFor(before: string | null | undefined, after: string | null | undefined): TaskEvent | null {
  if (!before || !after || before === after) return null;
  if (after === "done") return "completed";
  if (before === "done") return "reopened";
  return null;
}

/**
 * Records the event in the thread of the task itself, or of its parent when it is an action item, so the whole story
 * reads in one place. Never throws: a failed note must not undo the change it describes.
 */
export async function postTaskEvent(db: any, task: { id: string; title: string; parent_task_id?: string | null }, event: TaskEvent, actor: Actor): Promise<void> {
  try {
    const isItem = !!task.parent_task_id;
    await db.from("pm_task_comments").insert({
      task_id: isItem ? task.parent_task_id : task.id,
      author_id: actor.userId ?? null,
      author_professional_id: actor.professionalId ?? null,
      author_agent_key: actor.agentKey ?? null,
      body: taskEventText(event, actor.label, isItem ? task.title : null),
      body_format: "text",
      kind: "system",
    });
  } catch (e) {
    console.error("[task-events] could not record the event", e instanceof Error ? e.message : e);
  }
}
