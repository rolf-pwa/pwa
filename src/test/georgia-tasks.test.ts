import { describe, it, expect } from "vitest";
import { appendNote, decideOutcome, isReady, mustGoToRolf, nextOccurrence, noteLine, validRecurrence } from "../../supabase/functions/_shared/georgia-tasks";

describe("repeat settings", () => {
  it("accepts a week, month or year with a small whole interval, and defaults to every one", () => {
    expect(validRecurrence({ every: "year" })).toEqual({ every: "year", interval: 1 });
    expect(validRecurrence({ every: "month", interval: 3 })).toEqual({ every: "month", interval: 3 });
    expect(validRecurrence({ every: "year", owner: "georgia" })).toEqual({ every: "year", interval: 1, owner: "georgia" });
    expect(validRecurrence({ every: "year", owner: "someone" })).toEqual({ every: "year", interval: 1 });
  });
  it("refuses anything else", () => {
    for (const bad of [null, "year", {}, { every: "day" }, { every: "year", interval: 0 }, { every: "year", interval: 1.5 }, { every: "year", interval: 40 }]) expect(validRecurrence(bad)).toBeNull();
  });
});

describe("the next date", () => {
  it("is a year later, keeping the day", () => {
    expect(nextOccurrence("2027-07-15", { every: "year", interval: 1 })).toBe("2028-07-15");
  });
  it("keeps the last day when the month is shorter, and handles a leap day", () => {
    expect(nextOccurrence("2026-01-31", { every: "month", interval: 1 })).toBe("2026-02-28");
    expect(nextOccurrence("2028-02-29", { every: "year", interval: 1 })).toBe("2029-02-28");
  });
  it("rolls over the year for months and counts weeks", () => {
    expect(nextOccurrence("2026-11-15", { every: "month", interval: 3 })).toBe("2027-02-15");
    expect(nextOccurrence("2026-10-19", { every: "week", interval: 2 })).toBe("2026-11-02");
  });
});

describe("when she picks a task up", () => {
  it("waits until two weeks before the date, and works a task with no date at once", () => {
    expect(isReady("2027-07-15", "2026-10-19")).toBe(false);
    expect(isReady("2027-07-15", "2027-07-01")).toBe(true);
    expect(isReady("2027-07-15", "2027-06-30")).toBe(false);
    expect(isReady(null, "2026-10-19")).toBe(true);
    expect(isReady("2026-10-01", "2026-10-19")).toBe(true);
  });
});

describe("what she may close herself", () => {
  it("never closes anything about money or speaking to a client", () => {
    for (const t of ["Send $760 from TFSA to TD Bank account", "Process the withdrawal", "Wire the deposit", "Rebalance portfolios", "Reply to Geneva about her statement", "Email the client the plan", "Invoice for September"]) {
      expect(mustGoToRolf(t, null), t).toBe(true);
    }
  });
  it("lets her close plain research and set-up", () => {
    for (const t of ["Find the Weiss household's address", "Create the Vault for the Weiss household", "Look up hotels near the venue"]) expect(mustGoToRolf(t, null), t).toBe(false);
  });
  it("checks the description too, and overrides her own 'done'", () => {
    expect(mustGoToRolf("Annual task", "Send $760 from TFSA to TD Bank account.")).toBe(true);
    expect(decideOutcome("done", "Look up venues", null)).toBe("done");
    expect(decideOutcome("done", "Process the withdrawal", null)).toBe("needs_rolf");
    expect(decideOutcome("needs_rolf", "Look up venues", null)).toBe("needs_rolf");
    expect(decideOutcome(null, "Look up venues", null)).toBe("needs_rolf");
  });
});

describe("her notes on a task", () => {
  it("adds a dated line to what is already there", () => {
    const line = noteLine("2026-10-19", "Handed   to you\n ahead of the date.");
    expect(line).toBe("2026-10-19, Georgia: Handed to you ahead of the date.");
    expect(appendNote("Earlier note", line)).toBe(`Earlier note\n${line}`);
    expect(appendNote(null, line)).toBe(line);
  });
});

import { readFileSync } from "node:fs";
import { maybeCreateNextRecurrence } from "../../supabase/functions/_shared/task-recurrence";
import { BLOCKED_WHEN_WORKING_ALONE, WORK_MODE_PROMPT } from "../../supabase/functions/_shared/georgia-tasks";

/** A database stub for the one task, recording what is inserted. */
function db(task: Record<string, unknown> | null, insertError: { message: string } | null = null) {
  const inserted: Record<string, unknown>[] = [];
  const notes: Record<string, unknown>[] = [];
  const client = { from: (t: string) => t === "pm_tasks"
    ? { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: task }) }) }), insert: (r: Record<string, unknown>) => { inserted.push(r); return { select: () => ({ maybeSingle: async () => ({ data: insertError ? null : { id: "new1" }, error: insertError }) }) }; } }
    : { insert: async (r: Record<string, unknown>) => { notes.push(r); return {}; } } } as any;
  return { client, inserted, notes };
}
const base = { id: "t1", title: "Recurring: Withdrawal for Disability Insurance", description: "Send $760 from TFSA to TD Bank account.", status: "done", due_date: "2027-07-15", completed_at: "2027-07-14T18:00:00Z", parent_task_id: null, contact_id: "c1", household_id: "h1", family_id: "f1", client_visible: false, created_by: "u1", assignee_id: "u1", recurrence: { every: "year", interval: 1, owner: "georgia" } };

describe("a repeating task that is completed", () => {
  it("makes next year's task for Georgia, with the same details and the date a year on", async () => {
    const d = db(base);
    expect(await maybeCreateNextRecurrence(d.client, "t1")).toBe("new1");
    expect(d.inserted[0]).toMatchObject({ title: base.title, description: base.description, due_date: "2028-07-15", status: "open", assigned_agent_key: "georgia", assignee_id: null, recurred_from: "t1", contact_id: "c1", client_visible: false });
    expect(d.notes[0]).toMatchObject({ source_type: "task_recurrence" });
  });
  it("gives the next one to the same person when the series is not Georgia's", async () => {
    const d = db({ ...base, recurrence: { every: "month", interval: 1, owner: "same" }, due_date: "2099-01-31" });
    await maybeCreateNextRecurrence(d.client, "t1");
    expect(d.inserted[0]).toMatchObject({ assigned_agent_key: null, assignee_id: "u1", due_date: "2099-02-28" });
  });
  it("does nothing for a task that is not done, does not repeat, or is a subtask", async () => {
    for (const t of [{ ...base, status: "open" }, { ...base, recurrence: null }, { ...base, parent_task_id: "p" }, null]) {
      const d = db(t as any);
      expect(await maybeCreateNextRecurrence(d.client, "t1")).toBeNull();
      expect(d.inserted).toHaveLength(0);
    }
  });
  it("skips forward when it is completed very late, so the next is not already overdue", async () => {
    const d = db({ ...base, due_date: "2020-01-15", recurrence: { every: "year", interval: 1, owner: "georgia" } });
    await maybeCreateNextRecurrence(d.client, "t1");
    expect(String(d.inserted[0].due_date) > new Date().toISOString().slice(0, 10)).toBe(true);
  });
  it("makes only one: a repeat of the same completion is quietly ignored", async () => {
    const d = db(base, { message: 'duplicate key value violates unique constraint "uq_pm_tasks_recurred_from"' });
    expect(await maybeCreateNextRecurrence(d.client, "t1")).toBeNull();
    expect(d.notes).toHaveLength(0);
  });
});

describe("how Georgia works her own tasks", () => {
  const src = readFileSync("supabase/functions/_shared/georgia-task-service.ts", "utf8");
  it("watches a repeating task and hands it over without any model call, before working anything else", () => {
    expect(src.indexOf("if (task.recurrence)")).toBeGreaterThan(0);
    expect(src.indexOf("if (task.recurrence)")).toBeLessThan(src.indexOf("return await workTask("));
    const block = src.slice(src.indexOf("if (task.recurrence)"), src.indexOf("const attempts"));
    expect(block).not.toMatch(/callGemini|runAgentTurn|workTask/);
  });
  it("keeps every client-facing tool, and closing other than through the gate, out of her hands when she works alone", () => {
    for (const t of ["comment_on_task", "reply_to_request", "close_request", "complete_task"]) expect(BLOCKED_WHEN_WORKING_ALONE).toContain(t);
    expect(src).toContain("BLOCKED_WHEN_WORKING_ALONE");
    expect(WORK_MODE_PROMPT).toMatch(/cannot contact a client/);
    expect(src).toContain("decideOutcome(");
  });
  it("reports to staff-only notes and an in-app note, never in a comment a client could see", () => {
    expect(src).toContain("staff_notes");
    expect(src).not.toMatch(/pm_task_comments"\)\.insert/);
  });
  it("never sends the agent key to a client; they see only the label", () => {
    const portal = readFileSync("supabase/functions/portal-pm-tasks/index.ts", "utf8");
    expect(portal).toContain("assignee_label");
    expect(portal).toContain("forClient(data)");
  });
});
