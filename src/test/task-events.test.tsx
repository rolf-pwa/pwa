import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { eventFor, postTaskEvent, taskEventText } from "../../supabase/functions/_shared/task-events";
import { buildMeetingRecordHtml, type RecordInput } from "../../supabase/functions/_shared/meeting-record";
import { SystemCommentLine } from "@/shared/components/SystemCommentLine";

describe("what counts as completing or reopening", () => {
  it("recognises completion and reopening, and ignores everything else", () => {
    expect(eventFor("open", "done")).toBe("completed");
    expect(eventFor("in_progress", "done")).toBe("completed");
    expect(eventFor("done", "open")).toBe("reopened");
    expect(eventFor("done", "in_progress")).toBe("reopened");
    expect(eventFor("open", "in_progress")).toBeNull();
    expect(eventFor("done", "done")).toBeNull();
    expect(eventFor(undefined, "done")).toBeNull();
  });
  it("words the line for a task and for an action item", () => {
    expect(taskEventText("completed", "Rolf Issler", null)).toBe("Task completed by Rolf Issler");
    expect(taskEventText("reopened", "Georgia", "Request Policy Loan")).toBe("Action item reopened by Georgia: Request Policy Loan");
  });
});

/** A database stub that records the rows inserted into pm_task_comments. */
function db(fail = false) {
  const rows: Record<string, unknown>[] = [];
  return { rows, client: { from: () => ({ insert: async (r: Record<string, unknown>) => { if (fail) throw new Error("down"); rows.push(r); return {}; } }) } as any };
}

describe("recording the event in the thread", () => {
  it("puts a task's own event in its own thread, by the person who did it", async () => {
    const d = db();
    await postTaskEvent(d.client, { id: "t1", title: "Governance Review Followup" }, "completed", { label: "Rolf Issler", userId: "u1" });
    expect(d.rows[0]).toMatchObject({ task_id: "t1", author_id: "u1", body: "Task completed by Rolf Issler", kind: "system", body_format: "text" });
  });
  it("puts an action item's event in its parent's thread, naming the item", async () => {
    const d = db();
    await postTaskEvent(d.client, { id: "s1", title: "Request Policy Loan", parent_task_id: "t1" }, "completed", { label: "Georgia", agentKey: "georgia" });
    expect(d.rows[0]).toMatchObject({ task_id: "t1", author_agent_key: "georgia", body: "Action item completed by Georgia: Request Policy Loan", kind: "system" });
  });
  it("records a professional's event under them", async () => {
    const d = db();
    await postTaskEvent(d.client, { id: "t1", title: "x" }, "reopened", { label: "Dana Lee (professional)", professionalId: "p1" });
    expect(d.rows[0]).toMatchObject({ author_professional_id: "p1", author_id: null, body: "Task reopened by Dana Lee (professional)" });
  });
  it("never throws when the note cannot be saved", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(postTaskEvent(db(true).client, { id: "t1", title: "x" }, "completed", { label: "Rolf" })).resolves.toBeUndefined();
    spy.mockRestore();
  });
});

describe("showing the line", () => {
  it("shows the words and the time", () => {
    render(<SystemCommentLine body="Task completed by Rolf Issler" at="2026-10-22T21:10:00Z" />);
    const el = screen.getByTestId("system-comment");
    expect(el.textContent).toContain("Task completed by Rolf Issler");
    expect(el.textContent).toMatch(/2026/);
  });
});

describe("the meeting record's thread", () => {
  it("shows system lines as timestamped notes, not as a person's comment", () => {
    const base: RecordInput = {
      clientName: "Colleen", taskTitle: "Followup", taskCreatedAt: "2026-10-15T22:10:00Z", taskCompletedAt: "2026-10-22T21:10:00Z", event: null, recap: null, tasks: [],
      thread: [
        { at: "2026-10-20T18:00:00Z", author: "System", role: "System", body: "Task reopened by Rolf Issler", format: "text" },
        { at: "2026-10-22T21:10:00Z", author: "System", role: "System", body: "Task completed by Rolf Issler", format: "text" },
      ],
      generatedAt: "2026-10-22T21:11:00Z",
    };
    const h = buildMeetingRecordHtml(base);
    expect(h).toContain("Task reopened by Rolf Issler");
    expect(h).toContain("Task completed by Rolf Issler");
    expect(h).not.toContain("(System)");
    expect(h.indexOf("Task reopened")).toBeLessThan(h.indexOf("Task completed"));
  });
});

import { isEditableComment, releasedText, postTaskNote } from "../../supabase/functions/_shared/task-events";
import { textToHtml } from "@/shared/lib/sanitizeHtml";
import { RichCommentEditor } from "@/shared/components/RichCommentEditor";

describe("which comments can be edited", () => {
  it("allows what staff or Georgia wrote, and nothing else", () => {
    expect(isEditableComment({ author_id: "u1" })).toBe(true);
    expect(isEditableComment({ author_agent_key: "georgia" })).toBe(true);
    expect(isEditableComment({ author_contact_id: "c1" })).toBe(false);
    expect(isEditableComment({ author_professional_id: "p1" })).toBe(false);
    expect(isEditableComment({ author_id: "u1", kind: "system" })).toBe(false);
    expect(isEditableComment({})).toBe(false);
  });
});

describe("releasing a task to the client", () => {
  it("words the note and records it in the task's own thread", async () => {
    expect(releasedText("Rolf Issler")).toBe("Shared with the client by Rolf Issler");
    const rows: Record<string, unknown>[] = [];
    await postTaskNote({ from: () => ({ insert: async (r: Record<string, unknown>) => { rows.push(r); return {}; } }) } as any, "t1", releasedText("Rolf Issler"), { label: "Rolf Issler", userId: "u1" });
    expect(rows[0]).toMatchObject({ task_id: "t1", author_id: "u1", kind: "system", body: "Shared with the client by Rolf Issler" });
  });
});

describe("editing starts from the existing text", () => {
  it("turns plain text into editable lines without interpreting markup", () => {
    expect(textToHtml("Hi\n<b>x</b>\n")).toBe("<div>Hi</div><div>&lt;b&gt;x&lt;/b&gt;</div><div><br></div>");
  });
  it("shows the existing comment in the editor, cleaned, and reports it", () => {
    const onChange = vi.fn();
    render(<RichCommentEditor value="" onChange={onChange} initialHtml={'<p>Recap <strong>draft</strong></p><script>x()</script>'} />);
    const box = screen.getByRole("textbox");
    expect(box.innerHTML).toContain("<strong>draft</strong>");
    expect(box.innerHTML).not.toContain("script");
    expect(onChange).toHaveBeenCalledWith(expect.stringContaining("<strong>draft</strong>"));
  });
});
