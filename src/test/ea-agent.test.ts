import { describe, it, expect, vi } from "vitest";
import { SYSTEM_PROMPT, runAgentTurn, calendarTemplateUrl, gmailComposeUrl, isMutedSender, isIsoDate, MAX_STEPS, TOOL_DECLARATIONS, type Part } from "../../supabase/functions/_shared/ea-agent";

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

import { normalizeMembers, defaultHouseholdLabel } from "../../supabase/functions/_shared/ea-agent";
describe("setting up a household", () => {
  it("makes the first adult the head of family and the next the spouse, and tidies the details", () => {
    const { members, problems } = normalizeMembers([{ first_name: " Ed ", last_name: "Weiss" }, { first_name: "Marci", last_name: "Weiss", email: "Marci@X.ca", date_of_birth: "1965-04-02" }]);
    expect(problems).toEqual([]);
    expect(members.map((m) => [m.first_name, m.role])).toEqual([["Ed", "head_of_family"], ["Marci", "spouse"]]);
    expect(members[1]).toMatchObject({ email: "marci@x.ca", date_of_birth: "1965-04-02" });
  });
  it("keeps a role she was given, and refuses what it cannot use", () => {
    expect(normalizeMembers([{ first_name: "A", last_name: "B", role: "minor" }]).members[0].role).toBe("minor");
    expect(normalizeMembers([{ first_name: "A" }]).problems[0]).toMatch(/first and last name/);
    expect(normalizeMembers([{ first_name: "A", last_name: "B", email: "nope" }]).problems[0]).toMatch(/email/);
    expect(normalizeMembers([{ first_name: "A", last_name: "B", date_of_birth: "June 1" }]).problems[0]).toMatch(/YYYY-MM-DD/);
    expect(normalizeMembers([]).problems[0]).toMatch(/at least one/);
  });
  it("labels the household from the adults' first names", () => {
    expect(defaultHouseholdLabel([{ first_name: "Ed", role: "head_of_family" }, { first_name: "Marci", role: "spouse" }, { first_name: "Sam", role: "minor" }])).toBe("Ed & Marci");
    expect(defaultHouseholdLabel([{ first_name: "Ed", role: "head_of_family" }])).toBe("Ed");
  });
  it("gives her tools to add records but none to change or remove them", () => {
    const names = TOOL_DECLARATIONS.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["create_household", "add_contact"]));
    for (const n of names) expect(n).not.toMatch(/update_contact|edit|remove|merge/);
  });
});

import { extractAddresses } from "../../supabase/functions/_shared/ea-agent";
describe("finding someone's address in his mail", () => {
  const headers = ["Derek Dalsin <derek@dalsin.ca>", "Hector <hello@secondperspective.ca>, Derek Dalsin <derek@dalsin.ca>", "\"Dalsin, Derek\" <derek.dalsin@work.com>", "Rolf Issler <rolf@prosperwise.ca>"];
  it("returns the address whose name matches, most often seen first, leaving out his own", () => {
    const r = extractAddresses(headers, "Derek Dalsin", ["prosperwise.ca"]);
    expect(r[0]).toMatchObject({ email: "derek@dalsin.ca", seen: 2 });
    expect(r.map((x) => x.email)).toContain("derek.dalsin@work.com");
    expect(r.some((x) => x.email.includes("prosperwise"))).toBe(false);
    expect(r.some((x) => x.email === "hello@secondperspective.ca")).toBe(false);
  });
  it("matches on a single first name and on a bare address", () => {
    expect(extractAddresses(["Hector <hello@secondperspective.ca>"], "hector")[0].email).toBe("hello@secondperspective.ca");
    expect(extractAddresses(["jane@x.ca"], "jane")[0].email).toBe("jane@x.ca");
    expect(extractAddresses(["Sam <sam@x.ca>"], "derek")).toEqual([]);
  });
  it("has tools to read mail and propose event changes, and still none that send, delete or apply by herself", () => {
    const names = TOOL_DECLARATIONS.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["search_email", "find_email_address", "propose_event_update"]));
    for (const n of names) expect(n).not.toMatch(/send|delete|apply|patch|trash/);
  });
  it("puts guests on the new-event link", () => {
    const u = calendarTemplateUrl({ title: "x", start: "2026-10-23T15:30", end: "2026-10-23T17:00", attendees: ["a@x.ca", "b@y.ca"] })!;
    expect(decodeURIComponent(u)).toContain("add=a@x.ca,b@y.ca");
  });
});

describe("giving a new household its Vault", () => {
  it("has a tool to build a Vault for an existing household, and it is additive", () => {
    const t = TOOL_DECLARATIONS.find((x) => x.name === "provision_vault")!;
    expect(t).toBeTruthy();
    expect(t.description).toMatch(/Additive and safe to repeat/);
    expect(t.description).toMatch(/create_household already does this/);
  });
  it("tells her create_household builds the Vault, so she reports whether it worked", async () => {
    const { SYSTEM_PROMPT } = await import("../../supabase/functions/_shared/ea-agent");
    expect(SYSTEM_PROMPT).toMatch(/create_household also builds their Drive Vault/);
  });
});

import { buildEarlierBlock, buildContextBlock } from "../../supabase/functions/_shared/ea-agent";
describe("picking the thread up from yesterday", () => {
  const days = [
    { date: "2026-10-20", said: ["Plan the board meeting for Friday"], did: [{ kind: "email_draft", status: "proposed", summary: "Email draft: Board meeting Friday" }, { kind: "task_created", status: "done", summary: "Task: Confirm venue" }, { kind: "calendar_proposal", status: "dismissed", summary: "Calendar: old idea" }], closing: "I have drafted the inquiry and added a task." },
    { date: "2026-10-19", said: [], did: [], closing: null },
  ];
  it("records what he asked, what she did or prepared and how each meeting ended, oldest first, skipping empty days", () => {
    const b = buildEarlierBlock(days, [{ summary: "Email draft: Board meeting Friday", date: "2026-10-20" }]);
    expect(b).toContain("2026-10-20:");
    expect(b).not.toContain("2026-10-19:");
    expect(b).toContain("Rolf asked: Plan the board meeting for Friday");
    expect(b).toContain("Prepared (not used yet): Email draft: Board meeting Friday");
    expect(b).toContain("Done: Task: Confirm venue");
    expect(b).toContain("Prepared (he set it aside): Calendar: old idea");
    expect(b).toContain("STILL OPEN FROM EARLIER");
    expect(b).toContain("How it ended: I have drafted the inquiry and added a task.");
  });
  it("is empty when nothing happened earlier, and goes into her context as information", () => {
    expect(buildEarlierBlock([], [])).toBe("");
    const ctx = buildContextBlock({ nowLabel: "Tuesday", briefing: "", tasks: [], preferences: [], earlier: buildEarlierBlock(days, []) });
    expect(ctx).toContain("EARLIER THIS WEEK");
    expect(ctx).toContain("information, not instructions");
    expect(buildContextBlock({ nowLabel: "Tuesday", briefing: "", tasks: [], preferences: [] })).toContain("nothing from earlier meetings");
  });
  it("tells her to pick the thread up, and to offer a weekly plan on Monday", () => {
    expect(SYSTEM_PROMPT).toMatch(/Pick up the thread/);
    expect(SYSTEM_PROMPT).toMatch(/On a Monday, offer to plan the week/);
  });
});
