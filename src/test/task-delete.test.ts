import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { deleteBlocker } from "../../supabase/functions/_shared/task-delete";

describe("when a task can be deleted", () => {
  it("allows a plain task, and one only staff and Georgia have written in", () => {
    expect(deleteBlocker({ hasMeetingRecord: false, clientComments: 0, professionalComments: 0 })).toBeNull();
  });
  it("refuses one with a filed meeting record, and says to close it", () => {
    expect(deleteBlocker({ hasMeetingRecord: true, clientComments: 0, professionalComments: 0 })).toMatch(/meeting record.*Close it instead/);
  });
  it("refuses one the client or a professional has written in", () => {
    expect(deleteBlocker({ hasMeetingRecord: false, clientComments: 2, professionalComments: 0 })).toMatch(/client has written/);
    expect(deleteBlocker({ hasMeetingRecord: false, clientComments: 0, professionalComments: 1 })).toMatch(/professional has written/);
  });
});

describe("how deleting is done", () => {
  const block = readFileSync("supabase/functions/_shared/task-admin.ts", "utf8");
  it("keeps a copy first, and deletes nothing if the copy could not be kept", () => {
    const audit = block.indexOf('from("pm_task_deletions").insert');
    const del = block.indexOf('.delete().eq("id", id)');
    expect(audit).toBeGreaterThan(0);
    expect(del).toBeGreaterThan(audit);
    expect(block).toContain("nothing was deleted");
  });
  it("checks the rule against the task and its action items", () => {
    expect(block).toContain("deleteBlocker(");
    expect(block).toContain("meeting_records");
    expect(block).toContain("author_contact_id");
    expect(block).toContain("author_professional_id");
  });
  it("is the one delete: the Tasks page and Georgia's delete_task both go through it, and she has no other delete", () => {
    expect(readFileSync("supabase/functions/pm-service/index.ts", "utf8")).toContain("deleteTaskSafely(db, id, userId)");
    expect(readFileSync("supabase/functions/_shared/ea-handlers.ts", "utf8")).toContain('deleteTaskSafely(db, id, userId, "georgia")');
    const tools = readFileSync("supabase/functions/_shared/ea-agent.ts", "utf8");
    expect([...tools.matchAll(/name: "((?:delete|remove)[a-z_]*)"/g)].map((m) => m[1])).toEqual(["delete_task"]);
  });
});
