// Task workspace: which tasks show, in which group, in what order. Pure; no I/O.
import type { PmTask } from "@/shared/lib/agents";

export type Scope = "mine" | "georgia" | "everyone";
export type Bucket = "overdue" | "today" | "week" | "later" | "none";
export const BUCKETS: Bucket[] = ["overdue", "today", "week", "later", "none"];
export const BUCKET_LABEL: Record<Bucket, string> = { overdue: "Overdue", today: "Today", week: "This week", later: "Later", none: "No date" };

const dayNumber = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 86_400_000;

/** Where a task sits by its due date: "this week" is the seven days after today. */
export function bucketOf(task: Pick<PmTask, "due_date">, today: string): Bucket {
  const d = task.due_date?.slice(0, 10);
  if (!d) return "none";
  if (d < today) return "overdue";
  if (d === today) return "today";
  return dayNumber(d) - dayNumber(today) <= 7 ? "week" : "later";
}

/** The tasks that can be worked on: not done, and not a subtask (those are opened under their parent). */
export const openTasks = (tasks: PmTask[]): PmTask[] => tasks.filter((t) => t.status !== "done" && !t.parent_task_id);

export function inScope(task: PmTask, scope: Scope, userId: string | null): boolean {
  if (scope === "everyone") return true;
  if (scope === "georgia") return task.assigned_agent_key === "georgia";
  return !!userId && task.assignee_id === userId;
}

/** Soonest first, undated last, ties by title. */
export function byDue(a: PmTask, b: PmTask): number {
  if (a.due_date !== b.due_date) return !a.due_date ? 1 : !b.due_date ? -1 : a.due_date < b.due_date ? -1 : 1;
  return a.title.localeCompare(b.title);
}

export function matchesSearch(task: PmTask, q: string, extra: string[] = []): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return [task.title, ...extra].some((s) => s.toLowerCase().includes(needle));
}

/** How many tasks sit in each group, for the tabs. */
export function bucketCounts(tasks: PmTask[], today: string): Record<Bucket, number> {
  const c: Record<Bucket, number> = { overdue: 0, today: 0, week: 0, later: 0, none: 0 };
  for (const t of tasks) c[bucketOf(t, today)] += 1;
  return c;
}

/** The task a link points at, or the parent when it is a subtask (the parent is what the workspace opens). */
export function resolveSelected(all: PmTask[], id: string | null): PmTask | null {
  if (!id) return null;
  const t = all.find((x) => x.id === id);
  if (!t) return null;
  return t.parent_task_id ? all.find((x) => x.id === t.parent_task_id) ?? t : t;
}
