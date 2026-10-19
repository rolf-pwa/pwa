import { describe, it, expect } from "vitest";
import { accuracy, addressOf, correctionPlan, mutedMatch, ruleVerdict, verdictsFromModel, sweepPrompt, type SweepMessage } from "../../supabase/functions/_shared/inbox-sweep";

const msg = (o: Partial<SweepMessage>): SweepMessage => ({ id: "m1", from: "Someone <x@example.com>", subject: "Hello", snippet: "", ...o });
const clients = new Set(["ed@weiss.ca"]);

describe("ruleVerdict", () => {
  it("never lets a client message be anything but client, even if it looks like a newsletter", () => {
    const v = ruleVerdict(msg({ from: "Ed Weiss <Ed@Weiss.ca>", bulk: true, subject: "Weekly update" }), clients, []);
    expect(v?.bucket).toBe("client");
  });
  it("keeps firm mail with Rolf", () => expect(ruleVerdict(msg({ from: "a@prosperwise.ca" }), clients, [])?.bucket).toBe("needs_you"));
  it("keeps newsletters in FYI, and archives only muted senders and spam", () => {
    const v = ruleVerdict(msg({ bulk: true }), clients, []);
    expect(v?.bucket).toBe("fyi");
    expect(v?.reason).toMatch(/Move this sender to Would archive/);
    expect(ruleVerdict(msg({ from: "Deals <d@shop.com>" }), clients, ["shop.com"])?.bucket).toBe("archivable");
  });
  it("names the entry that muted a sender, and matches the sender only, never the subject", () => {
    expect(ruleVerdict(msg({ from: "Ant <ant@supabase.com>" }), clients, ["supabase"])?.reason).toBe('You asked Georgia to stop showing mail from "supabase"');
    expect(mutedMatch(msg({ from: "Ed <ed@x.com>", subject: "Your Supabase project is ready" }), ["supabase"])).toBeNull();
    expect(mutedMatch(msg({ from: "Ant <ant@supabase.com>" }), ["ab"])).toBeNull(); // too short to be safe
  });
  it("sorts a sender the way Rolf told it to, over every rule except a client", () => {
    const learned = new Map<string, "needs_you" | "fyi" | "archivable">([["web@mail-corpo.ia.ca", "fyi"], ["ed@weiss.ca", "archivable"], ["x@example.com", "archivable"]]);
    const ia = ruleVerdict(msg({ from: "iA Financial Group <web@mail-corpo.ia.ca>", bulk: true }), clients, ["ia financial"], learned);
    expect(ia).toMatchObject({ bucket: "fyi", decidedBy: "learned" });
    expect(ia?.reason).toMatch(/You told Georgia mail from this sender belongs in FYI/);
    expect(ruleVerdict(msg({ from: "Ed <ed@weiss.ca>" }), clients, [], learned)?.bucket).toBe("client");
    expect(ruleVerdict(msg({ from: "x@example.com", subject: "Action required" }), clients, [], learned)?.bucket).toBe("archivable");
  });
  it("flags deadlines and leaves the rest to the model", () => {
    expect(ruleVerdict(msg({ subject: "Action required: sign by Friday" }), clients, [])?.bucket).toBe("needs_you");
    expect(ruleVerdict(msg({}), clients, [])).toBeNull();
  });
});

describe("verdictsFromModel", () => {
  const msgs = [msg({ id: "a" }), msg({ id: "b" }), msg({ id: "c" })];
  it("maps by number and never invents archivable for gaps or bad entries", () => {
    const v = verdictsFromModel(msgs, { items: [{ n: 1, bucket: "archivable", reason: "promo" }, { n: 2, bucket: "client", reason: "x" }, { n: 9, bucket: "fyi", reason: "x" }] });
    expect(v.map((x) => x.bucket)).toEqual(["archivable", "needs_you", "needs_you"]);
  });
  it("survives garbage", () => expect(verdictsFromModel(msgs, null).every((x) => x.bucket === "needs_you")).toBe(true));
});

describe("helpers", () => {
  it("reads the address", () => expect(addressOf("Ed <Ed@Weiss.ca>")).toBe("ed@weiss.ca"));
  it("puts only message headers in the prompt", () => expect(sweepPrompt([msg({ snippet: "x".repeat(500) })]).length).toBeLessThan(900));
  it("judges accuracy on what Georgia first proposed, even after Rolf moved the message", () => {
    const a = accuracy([{ bucket: "fyi", proposed_bucket: "archivable", feedback: "wrong" }, { bucket: "archivable", proposed_bucket: "archivable", feedback: "right" }, { bucket: "fyi", proposed_bucket: "fyi", feedback: "right" }]);
    expect(a.archivable).toEqual({ rated: 2, right: 1 });
    expect(a.overall).toEqual({ rated: 3, right: 2 });
  });
  it("computes accuracy", () => {
    const a = accuracy([{ bucket: "archivable", feedback: "right" }, { bucket: "archivable", feedback: "wrong" }, { bucket: "fyi", feedback: null }]);
    expect(a.overall).toEqual({ rated: 2, right: 1 });
    expect(accuracy([]).overall).toBeNull();
  });
});

describe("correcting a sort", () => {
  const item = { from_addr: "Justin Welsh <hello@justinwelsh.me>", bucket: "archivable" as const };
  it("moves the message and names the sender to remember", () => {
    expect(correctionPlan(item, "fyi")).toEqual({ correct: "fyi", sender: "hello@justinwelsh.me" });
  });
  it("refuses a move to the same place, to clients, to nonsense, or for a client's message", () => {
    expect(correctionPlan(item, "archivable")).toBeNull();
    expect(correctionPlan(item, "client")).toBeNull();
    expect(correctionPlan(item, "inbox")).toBeNull();
    expect(correctionPlan({ ...item, bucket: "client" }, "fyi")).toBeNull();
  });
  it("moves the message but remembers no sender when there is no usable address", () => {
    expect(correctionPlan({ from_addr: "(unknown)", bucket: "fyi" }, "needs_you")).toEqual({ correct: "needs_you", sender: "" });
  });
});

import { sweepLine } from "../../supabase/functions/_shared/inbox-sweep";
import { readFileSync } from "node:fs";

describe("the line in the morning briefing", () => {
  it("says what the sweep found, leaving out what is zero", () => {
    expect(sweepLine({ needs_you: 4, fyi: 6, archivable: 12, client: 3 })).toBe("Inbox sweep: 4 need you, 6 FYI, 12 would archive, 3 from clients. Review the sorts");
    expect(sweepLine({ needs_you: 1, client: 1 })).toBe("Inbox sweep: 1 needs you, 1 from a client. Review the sorts");
    expect(sweepLine({ fyi: 2, needs_you: 0 })).toBe("Inbox sweep: 2 FYI. Review the sorts");
  });
  it("says nothing when nothing was sorted", () => {
    expect(sweepLine({})).toBeNull();
    expect(sweepLine({ needs_you: 0, fyi: 0 })).toBeNull();
  });
});

describe("the morning run", () => {
  const mig = readFileSync("supabase/migrations/20261204120000_inbox_sweep_morning.sql", "utf8");
  it("is scheduled before the briefing, in summer and winter time, and acts only at 4:30 Pacific", () => {
    expect(mig).toContain("'30 11 * * *'");
    expect(mig).toContain("'30 12 * * *'");
    expect((mig.match(/"onlyAtPacificHour":4/g) ?? []).length).toBe(2);
    expect(mig).toContain('"job":"inbox_sweep_morning"');
  });
  it("can be turned off, and only ever reads mail", () => {
    const h = readFileSync("supabase/functions/_shared/inbox-sweep-handlers.ts", "utf8");
    expect(h).toContain("cfg.auto === false");
    expect(h).not.toMatch(/gmail\.googleapis\.com\/gmail\/v1\/users\/me\/messages\/[^`]*\/(modify|trash|delete|send)|method:\s*"(POST|DELETE|PUT|PATCH)"[^}]*gmail/);
  });
});
