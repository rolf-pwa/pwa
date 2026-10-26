/**
 * A task with subtasks is listed once, as the parent. A subtask drops out when its parent is in the same list; one whose parent is not
 * (assigned to someone else, or already done) stays, so it is never lost.
 */
export function withoutListedSubtasks<T extends { id: string; parent_task_id?: string | null }>(tasks: T[]): T[] {
  const ids = new Set(tasks.map((t) => t.id));
  return tasks.filter((t) => !t.parent_task_id || !ids.has(t.parent_task_id));
}
