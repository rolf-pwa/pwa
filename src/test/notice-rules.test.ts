import { describe, it, expect } from "vitest";
import { candidatePeople, decide, mayAutoClose, noticeCompletes } from "../../supabase/functions/_shared/notice-rules";
import { readFileSync } from "node:fs";

describe("does a notice complete the work?", () => {
  it("treats signed-and-filed and approvals as complete, requests and problems as not", () => {
    expect(noticeCompletes("adobe_sign", "26-10-15Jerczynski-Investor Profile ... is Signed and Filed!", "")).toBe(true);
    expect(noticeCompletes("adobe_sign", 'Signature requested on "Investor Profile"', "")).toBe(false);
    expect(noticeCompletes("adobe_sign", "Reminder: please sign", "")).toBe(false);
    expect(noticeCompletes("ia_notice", "Application approved for Colleen Jerczynski", "")).toBe(true);
    expect(noticeCompletes("ia_notice", "Automatic Reply from Industrial Alliance", "We have received your request.")).toBe(false);
    expect(noticeCompletes("ia_notice", "Contract issued", "Outstanding requirement: missing signature")).toBe(false);
  });
});

describe("may Georgia close the task?", () => {
  const base = { kind: "adobe_sign" as const, subject: "Investor Profile is Signed and Filed!", body: "", taskTitle: "Colleen Jerczynski: Investor Profile", recurrence: null, openSubtasks: 0 };
  it("closes a plain task the notice completes", () => expect(mayAutoClose(base)).toBe(true));
  it("never closes money work, repeating tasks, tasks with open subtasks, or the unfinished", () => {
    expect(mayAutoClose({ ...base, taskTitle: "Geneva: $1,500 Banking Withdrawal" })).toBe(false);
    expect(mayAutoClose({ ...base, taskTitle: "Wire the transfer" })).toBe(false);
    expect(mayAutoClose({ ...base, recurrence: "year" })).toBe(false);
    expect(mayAutoClose({ ...base, openSubtasks: 2 })).toBe(false);
    expect(mayAutoClose({ ...base, subject: "Signature requested on Investor Profile" })).toBe(false);
    expect(mayAutoClose({ ...base, alreadyDone: true })).toBe(false);
  });
});

describe("which client is it about?", () => {
  const people = [
    { id: "1", first_name: "Colleen", last_name: "Jerczynski" },
    { id: "2", first_name: "Rick", last_name: "Jerczynski" },
    { id: "3", first_name: "Ann", last_name: "Smith" },
  ];
  it("needs both first and last name, ignoring case and accents", () => {
    expect(candidatePeople("26-10-15 JERCZYNSKI-Investor Profile between ProsperWise, Colleen J and Rolf", people).map((p) => p.id)).toEqual(["1"]); // Colleen and the surname, not Rick
    expect(candidatePeople("A Jerczynski account notice", people)).toEqual([]); // surname alone matches nobody
    expect(candidatePeople("Investor profile for Colleen Jerczynski is signed", people).map((p) => p.id)).toEqual(["1"]);
    expect(candidatePeople("Colleen Jerczynski and Rick Jerczynski", people).map((p) => p.id)).toEqual(["1", "2"]);
  });
});

describe("what the code allows after the model chooses", () => {
  const ids = ["t1", "t2"];
  it("only acts on one clearly matched, high-confidence task", () => {
    expect(decide({ task_id: "t1", confidence: "high" }, ids, true)).toEqual({ act: "comment" });
    expect(decide({ task_id: "t1", confidence: "high", completes_task: true }, ids, true)).toEqual({ act: "close" });
    expect(decide({ task_id: "t1", confidence: "high", completes_task: true }, ids, false)).toEqual({ act: "comment" });
  });
  it("flags anything uncertain, ambiguous or invented", () => {
    expect(decide({ confidence: "high" }, ids, true).act).toBe("flag");
    expect(decide({ task_id: "t9", confidence: "high" }, ids, true).act).toBe("flag");
    expect(decide({ task_id: "t1", confidence: "medium" }, ids, true).act).toBe("flag");
    expect(decide({ task_id: "t1", confidence: "high", other_plausible: true }, ids, true).act).toBe("flag");
  });
});

describe("the processor itself", () => {
  const svc = readFileSync("supabase/functions/_shared/notice-service.ts", "utf8");
  it("never emails or texts anyone, never deletes, and flags what it cannot handle", () => {
    expect(svc).not.toMatch(/sendServiceEmail|callizySend|quoFetch|\.delete\(|trash/);
    expect(svc).toContain('"notice_flagged"');
    expect(svc).toContain("mayAutoClose");
    expect(readFileSync("supabase/functions/daily-briefing-generate/index.ts", "utf8")).toContain('cronBody.job === "notice_processor"');
  });
});
