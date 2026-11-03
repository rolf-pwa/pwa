import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { PmTask } from "../shared/lib/agents";
import { bucketCounts, bucketOf, byDue, inScope, matchesSearch, openTasks, resolveSelected } from "../modules/pm/lib/taskWorkspace";

const TODAY = "2026-11-04";
const t = (o: Partial<PmTask> = {}): PmTask => ({
  id: "t1", project_id: null, parent_task_id: null, title: "Send the transfer form", description: null, status: "open", due_date: null, assignee_id: "rolf", assigned_agent_key: null,
  household_id: null, contact_id: null, corporation_id: null, family_id: null, completed_at: null, client_visible: false, created_by: "rolf", created_at: "", updated_at: "", ...o,
});

describe("which group a task is in", () => {
  it("sorts by due date against today: overdue, today, the next seven days, later, and undated", () => {
    expect(bucketOf(t({ due_date: "2026-11-03" }), TODAY)).toBe("overdue");
    expect(bucketOf(t({ due_date: "2026-11-04" }), TODAY)).toBe("today");
    expect(bucketOf(t({ due_date: "2026-11-11" }), TODAY)).toBe("week");
    expect(bucketOf(t({ due_date: "2026-11-12" }), TODAY)).toBe("later");
    expect(bucketOf(t({ due_date: null }), TODAY)).toBe("none");
  });
  it("counts across a month end", () => {
    expect(bucketOf(t({ due_date: "2026-12-01" }), "2026-11-30")).toBe("week");
    expect(bucketCounts([t({ due_date: "2026-11-01" }), t({ due_date: "2026-11-04" }), t({ due_date: "2026-11-30" }), t()], TODAY)).toEqual({ overdue: 1, today: 1, week: 0, later: 1, none: 1 });
  });
});

describe("which tasks the workspace lists", () => {
  it("leaves out done tasks and subtasks, which open under their parent", () => {
    const list = openTasks([t({ id: "a" }), t({ id: "b", status: "done" }), t({ id: "c", parent_task_id: "a" })]);
    expect(list.map((x) => x.id)).toEqual(["a"]);
  });
  it("narrows by whose they are", () => {
    const mine = t({ assignee_id: "rolf" }), georgia = t({ assignee_id: null, assigned_agent_key: "georgia" });
    expect(inScope(mine, "mine", "rolf")).toBe(true);
    expect(inScope(georgia, "mine", "rolf")).toBe(false);
    expect(inScope(georgia, "georgia", "rolf")).toBe(true);
    expect(inScope(georgia, "everyone", null)).toBe(true);
    expect(inScope(mine, "mine", null)).toBe(false);
  });
  it("orders soonest first with undated last, then by title", () => {
    const sorted = [t({ id: "n", title: "B" }), t({ id: "late", due_date: "2026-11-09", title: "A" }), t({ id: "soon", due_date: "2026-11-05", title: "Z" }), t({ id: "n2", title: "A" })].sort(byDue);
    expect(sorted.map((x) => x.id)).toEqual(["soon", "late", "n2", "n"]);
  });
  it("searches the title and the project or client names", () => {
    expect(matchesSearch(t(), "transfer")).toBe(true);
    expect(matchesSearch(t(), "jordan", ["Jordan Rivers-Hale"])).toBe(true);
    expect(matchesSearch(t(), "nothing")).toBe(false);
    expect(matchesSearch(t(), "  ")).toBe(true);
  });
  it("opens the parent when a link points at a subtask", () => {
    const all = [t({ id: "a" }), t({ id: "b", parent_task_id: "a" })];
    expect(resolveSelected(all, "b")?.id).toBe("a");
    expect(resolveSelected(all, "a")?.id).toBe("a");
    expect(resolveSelected(all, "missing")).toBeNull();
    expect(resolveSelected(all, null)).toBeNull();
  });
});

describe("wiring", () => {
  const read = (p: string) => readFileSync(p, "utf8");
  it("the route and the Tasks slider lead to the workspace, and the slider's tasks open there", () => {
    expect(read("src/App.tsx")).toContain('path="/tasks"');
    expect(read("src/modules/crm/components/TodayTabs.tsx")).toContain('data-testid="open-task-workspace"');
    expect(read("src/modules/crm/lib/today.ts")).toContain("`/tasks?task=${t.id}`");
  });
  it("opens the full task panel, not a summary", () => {
    expect(read("src/modules/pm/pages/TaskWorkspace.tsx")).toContain("<TaskDetailPanel key={selected.id}");
  });
});
