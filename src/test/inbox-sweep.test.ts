import { describe, it, expect } from "vitest";
import { accuracy, adminCompanionQuery, quietReplyKeys, sweepQuery, addressOf, archiveTargets, correctionPlan, mutedMatch, ruleVerdict, verdictsFromModel, sweepPrompt, type SweepMessage } from "../../supabase/functions/_shared/inbox-sweep";

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
  it("keeps carrier, MGA, church and community mail in FYI without asking the model, but a deadline, a learned sender or a mute still wins", () => {
    for (const from of ["Kayla <info@wealthlinkfinancial.ca>", "iA <web@mail-corpo.ia.ca>", "Foresters <sales@email.foresters.com>", "Trinity Church Family <hello@trinitykelowna.ca>", "Jenn <mailer@churchcenteronline.com>"]) {
      expect(ruleVerdict(msg({ from, subject: "Announcing the growth challenge" }), clients, [])?.bucket).toBe("fyi");
    }
    expect(ruleVerdict(msg({ from: "Kayla <info@wealthlinkfinancial.ca>", subject: "Action required: renew by Friday" }), clients, [])?.bucket).toBe("needs_you");
    expect(ruleVerdict(msg({ from: "Kayla <info@wealthlinkfinancial.ca>" }), clients, [], new Map([["info@wealthlinkfinancial.ca", "archivable" as const]]))?.bucket).toBe("archivable");
    expect(ruleVerdict(msg({ from: "Capital One <capitalone@notification.capitalone.com>", subject: "Want to repay faster?" }), clients, [])).toBeNull(); // retail still goes to the model
  });
  it("tells the model that carrier, MGA and community mail is never archivable", () => {
    expect(sweepPrompt([msg({})])).toContain("Never mail from insurance carriers");
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
  it("puts only message headers in the prompt", () => expect(sweepPrompt([msg({ snippet: "x".repeat(500) })]).length).toBeLessThan(1300));
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

describe("archiveTargets", () => {
  const row = (bucket: any, feedback: any = null, extra: any = {}) => ({ bucket, feedback, ...extra });
  const items = [
    row("archivable", "right"), row("archivable"), row("archivable", "wrong"),
    row("fyi", "right"), row("needs_you"), row("client", "right"),
    row("archivable", "right", { archived_at: "2026-10-19" }), row("archivable", "right", { undone_at: "2026-10-19" }),
  ];
  it("rated: only Would-archive marked right, not already archived or put back", () => {
    expect(archiveTargets(items, "rated")).toHaveLength(1);
  });
  it("all: every Would-archive not marked wrong, never other buckets", () => {
    const got = archiveTargets(items, "all");
    expect(got).toHaveLength(2);
    expect(got.every((i) => i.bucket === "archivable" && i.feedback !== "wrong")).toBe(true);
  });
});

describe("the shared admin inbox", () => {
  it("is part of what the sweep lists, as unread mail wherever it landed", () => {
    expect(sweepQuery(7)).toBe("{in:inbox (to:admin@prosperwise.ca is:unread -in:trash -in:spam -in:sent)} newer_than:7d");
  });
  it("is searched alongside any Inbox search, but not twice", () => {
    expect(adminCompanionQuery("in:inbox newer_than:1d")).toBe("to:admin@prosperwise.ca in:anywhere -in:trash -in:spam -in:sent newer_than:1d");
    expect(adminCompanionQuery("from:derek")).toBeNull();
    expect(adminCompanionQuery("in:inbox to:admin@prosperwise.ca")).toBeNull();
  });
});

describe("mail Today leaves out of To reply to", () => {
  const r = (id: string, from: string) => ({ id, key: `email:${id}`, from });
  const replies = [r("1", "Capital One <capitalone@notification.capitalone.com>"), r("2", "Jane Client <jane@x.ca>"), r("3", "The Quo Team <team@quo.com>"), r("4", "Kayla <info@wealthlinkfinancial.ca>")];
  it("is what the sweep put in FYI or Would archive, and mail from a sender Rolf sorted that way", () => {
    const sorted = new Map<string, "fyi" | "archivable" | "needs_you" | "client">([["3", "fyi"], ["2", "needs_you"]]);
    const learned = new Map<string, "fyi" | "archivable" | "needs_you" | "client">([["capitalone@notification.capitalone.com", "archivable"], ["info@wealthlinkfinancial.ca", "needs_you"]]);
    expect(quietReplyKeys(replies, sorted, learned)).toEqual(["email:1", "email:3"]);
  });
  it("lets a message's own sort beat its sender's, in both directions", () => {
    const learned = new Map<string, "fyi" | "archivable" | "needs_you" | "client">([["jane@x.ca", "fyi"], ["capitalone@notification.capitalone.com", "fyi"]]);
    const sorted = new Map<string, "fyi" | "archivable" | "needs_you" | "client">([["2", "needs_you"], ["1", "needs_you"]]);
    expect(quietReplyKeys(replies, sorted, learned)).toEqual([]); // Rolf put these two in Needs you himself
  });
  it("leaves everything alone when nothing has been sorted", () => {
    expect(quietReplyKeys(replies, new Map(), new Map())).toEqual([]);
  });
});
