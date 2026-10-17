import { describe, it, expect, vi } from "vitest";
import { runAgentTurn, calendarTemplateUrl, gmailComposeUrl, isMutedSender, isIsoDate, MAX_STEPS, TOOL_DECLARATIONS, type Part } from "../../supabase/functions/_shared/ea-agent";

const model = (...replies: Part[][]) => { let i = 0; return vi.fn(async () => ({ parts: replies[Math.min(i++, replies.length - 1)] })); };

describe("a turn of the meeting", () => {
  it("answers directly when no tool is needed", async () => {
    const r = await runAgentTurn([{ role: "user", parts: [{ text: "hi" }] }], { callModel: model([{ text: "Good morning, Rolf." }]), runTool: vi.fn() });
    expect(r).toMatchObject({ text: "Good morning, Rolf.", steps: 1, toolCalls: [], stoppedEarly: false });
  });
  it("runs a tool, hands the result back, and ends on the model's own words", async () => {
    const runTool = vi.fn(async () => ({ ok: true, message: "Task created." }));
    const callModel = model([{ functionCall: { name: "create_task", args: { title: "Confirm venue", due_date: "2026-10-21" } } }], [{ text: "Done: I added 'Confirm venue' for Wednesday." }]);
    const r = await runAgentTurn([{ role: "user", parts: [{ text: "remind me" }] }], { callModel, runTool });
    expect(runTool).toHaveBeenCalledWith("create_task", { title: "Confirm venue", due_date: "2026-10-21" });
    expect(r.text).toMatch(/Confirm venue/);
    expect(r.toolCalls).toHaveLength(1);
    // The second request carries the model's call and the tool's answer.
    const second = (callModel.mock.calls[1] as unknown as [any[]])[0];
    expect(second.at(-2).role).toBe("model");
    expect(second.at(-1).parts[0].functionResponse).toMatchObject({ name: "create_task", response: { ok: true, message: "Task created." } });
  });
  it("tells the model when a tool fails, rather than pretending it worked", async () => {
    const runTool = vi.fn(async () => { throw new Error("calendar unavailable"); });
    const callModel = model([{ functionCall: { name: "check_calendar", args: {} } }], [{ text: "I couldn't read your calendar." }]);
    const r = await runAgentTurn([{ role: "user", parts: [{ text: "what's free?" }] }], { callModel, runTool });
    expect(r.toolCalls[0].outcome).toMatchObject({ ok: false, message: expect.stringContaining("calendar unavailable") });
  });
  it("stops after the step limit instead of looping for ever", async () => {
    const callModel = model([{ functionCall: { name: "web_search", args: { query: "x" } } }]);
    const r = await runAgentTurn([{ role: "user", parts: [{ text: "go" }] }], { callModel, runTool: async () => ({ ok: true, message: "ok" }) });
    expect(r.stoppedEarly).toBe(true);
    expect(callModel).toHaveBeenCalledTimes(MAX_STEPS);
  });
  it("gives her no tool that sends, deletes, pays or books", () => {
    const names = TOOL_DECLARATIONS.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["draft_email", "draft_text", "propose_calendar_event"]));
    for (const n of names) expect(n).not.toMatch(/send|delete|pay|book|trash|transfer/);
  });
});

describe("links Rolf clicks", () => {
  it("builds a prefilled calendar link in Pacific time", () => {
    const u = calendarTemplateUrl({ title: "Board Meeting", start: "2026-10-23T15:30", end: "2026-10-23T17:00", location: "The Pub, Kelowna" })!;
    expect(u).toContain("calendar.google.com/calendar/render");
    expect(u).toContain("dates=20261023T153000%2F20261023T170000");
    expect(u).toContain("ctz=America%2FVancouver");
    expect(calendarTemplateUrl({ title: "x", start: "Friday", end: "later" })).toBeNull();
  });
  it("builds a Gmail compose link with the recipient, subject and body", () => {
    const u = gmailComposeUrl({ to: "events@pub.ca", subject: "Board meeting Friday", body: "Hello,\nDo you have space?\nRolf" });
    expect(u).toContain("view=cm");
    expect(u).toContain("to=events%40pub.ca");
    expect(u).toContain("su=Board+meeting+Friday");
  });
});

describe("remembered preferences", () => {
  it("mutes a sender by part of the name or address, ignoring case and very short matches", () => {
    expect(isMutedSender("Venn <info@venn.ca>", ["venn"])).toBe(true);
    expect(isMutedSender("Jane <jane@gmail.com>", ["venn"])).toBe(false);
    expect(isMutedSender("Anyone <a@b.ca>", ["a"])).toBe(false);
  });
  it("accepts only real dates", () => { expect(isIsoDate("2026-10-23")).toBe(true); expect(isIsoDate("Friday")).toBe(false); expect(isIsoDate("2026-13-40")).toBe(false); });
});
