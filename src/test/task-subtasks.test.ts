import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { withoutListedSubtasks } from "../../supabase/functions/_shared/task-filter";

describe("subtasks in the task lists", () => {
  it("lists a task with subtasks once, as the parent", () => {
    const list = [{ id: "p", parent_task_id: null }, { id: "s1", parent_task_id: "p" }, { id: "s2", parent_task_id: "p" }, { id: "other" }];
    expect(withoutListedSubtasks(list).map((t) => t.id)).toEqual(["p", "other"]);
  });
  it("keeps a subtask whose parent is not in the list, so it is never lost", () => {
    expect(withoutListedSubtasks([{ id: "s", parent_task_id: "somewhere-else" }]).map((t) => t.id)).toEqual(["s"]);
  });
  it("applies to the briefing's task facts, which feed Today's Tasks panel", () => {
    const fn = readFileSync("supabase/functions/daily-briefing-generate/index.ts", "utf8");
    expect(fn).toContain("withoutListedSubtasks((allTasks || [])");
    expect(fn).toContain("withoutListedSubtasks((gt ?? [])");
    expect(fn).toContain('"id, project_id, contact_id, household_id, family_id, title, due_date, parent_task_id"');
  });
});
