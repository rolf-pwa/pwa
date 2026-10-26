import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../supabase/functions/_shared/task-notify.ts", () => ({ notifyClientsOfComment: vi.fn() }));
import { deleteTaskSafely, setTaskClientVisible } from "../../supabase/functions/_shared/task-admin";

// A tiny in-memory stand-in for the tables the helpers use.
function fakeDb(o: { task?: any; subs?: any[]; comments?: any[]; records?: any[]; auditFails?: boolean } = {}) {
  const calls: string[] = [];
  const db: any = {
    calls,
    from(table: string) {
      const q: any = { _t: table };
      q.select = () => q; q.eq = () => q; q.in = () => q;
      q.maybeSingle = async () => ({ data: o.task ?? null });
      q.then = (res: any) => res({ data: table === "pm_tasks" ? o.subs ?? [] : table === "pm_task_comments" ? o.comments ?? [] : o.records ?? [] });
      q.insert = async (row: any) => { calls.push(`insert ${table}`); if (table === "pm_task_deletions") q.row = row; return { error: o.auditFails && table === "pm_task_deletions" ? { message: "x" } : null }; };
      q.delete = () => ({ eq: async () => { calls.push(`delete ${table}`); return { error: null }; } });
      q.update = (patch: any) => ({ eq: async () => { calls.push(`update ${table} ${JSON.stringify(patch)}`); return { error: null }; } });
      return q;
    },
  };
  return db;
}
const task = { id: "t1", title: "Chase the form", contact_id: "c1", household_id: "h1", parent_task_id: null, client_visible: false };

describe("Georgia deleting a task", () => {
  it("deletes a plain task after keeping a copy, and says how many action items went with it", async () => {
    const db = fakeDb({ task, subs: [{ id: "s1" }, { id: "s2" }] });
    expect(await deleteTaskSafely(db, "t1", "u1", "georgia")).toEqual({ ok: true, title: "Chase the form", subtasks: 2 });
    expect(db.calls).toEqual(["insert pm_task_deletions", "delete pm_tasks"]);
  });
  it("refuses a task a client has written in, or that has a meeting record, and deletes nothing", async () => {
    const written = fakeDb({ task, comments: [{ author_contact_id: "c1" }] });
    expect(await deleteTaskSafely(written, "t1", "u1", "georgia")).toMatchObject({ ok: false, status: 409 });
    expect(written.calls).toEqual([]);
    const recorded = fakeDb({ task, records: [{ task_id: "t1" }] });
    expect(await deleteTaskSafely(recorded, "t1", "u1", "georgia")).toMatchObject({ ok: false, status: 409 });
    expect(recorded.calls).toEqual([]);
  });
  it("deletes nothing when the copy cannot be kept", async () => {
    const db = fakeDb({ task, auditFails: true });
    expect(await deleteTaskSafely(db, "t1", "u1")).toMatchObject({ ok: false, status: 500 });
    expect(db.calls).not.toContain("delete pm_tasks");
  });
  it("says so when there is no such task", async () => {
    expect(await deleteTaskSafely(fakeDb(), "nope", "u1")).toMatchObject({ ok: false, status: 404 });
  });
});

describe("Georgia sharing a task with the client", () => {
  it("shares it, notes it in the thread and tells the client", async () => {
    const db = fakeDb();
    (globalThis as any).EdgeRuntime = { waitUntil: () => undefined };
    Deno_env();
    const r = await setTaskClientVisible(db, task, true, { label: "Georgia", agentKey: "georgia" });
    expect(r).toEqual({ changed: true, told: true });
    expect(db.calls.some((c: string) => c.startsWith('update pm_tasks {"client_visible":true}'))).toBe(true);
    expect(db.calls).toContain("insert pm_task_comments");
  });
  it("hides it without telling anyone, and does nothing when it is already so", async () => {
    const db = fakeDb();
    expect(await setTaskClientVisible(db, { ...task, client_visible: true }, false, { label: "Georgia" })).toEqual({ changed: true, told: false });
    expect(await setTaskClientVisible(fakeDb(), { ...task, client_visible: true }, true, { label: "Georgia" })).toEqual({ changed: false, told: false });
  });
  it("never releases an action item on its own", async () => {
    const r = await setTaskClientVisible(fakeDb(), { ...task, parent_task_id: "p" }, true, { label: "Georgia" });
    expect(r.told).toBe(false);
  });
});

describe("the tools", () => {
  it("are offered to Georgia and handled, and the Tasks page uses the same delete", () => {
    const agent = readFileSync("supabase/functions/_shared/ea-agent.ts", "utf8");
    const handlers = readFileSync("supabase/functions/_shared/ea-handlers.ts", "utf8");
    for (const n of ["delete_task", "set_task_client_visible"]) { expect(agent).toContain(`name: "${n}"`); expect(handlers).toContain(`case "${n}"`); }
    expect(readFileSync("supabase/functions/pm-service/index.ts", "utf8")).toContain("deleteTaskSafely(db, id, userId)");
  });
});

function Deno_env() { (globalThis as any).Deno = { env: { get: () => "x" } }; }
