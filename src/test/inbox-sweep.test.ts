import { describe, it, expect } from "vitest";
import { accuracy, addressOf, ruleVerdict, verdictsFromModel, sweepPrompt, type SweepMessage } from "../../supabase/functions/_shared/inbox-sweep";

const msg = (o: Partial<SweepMessage>): SweepMessage => ({ id: "m1", from: "Someone <x@example.com>", subject: "Hello", snippet: "", ...o });
const clients = new Set(["ed@weiss.ca"]);

describe("ruleVerdict", () => {
  it("never lets a client message be anything but client, even if it looks like a newsletter", () => {
    const v = ruleVerdict(msg({ from: "Ed Weiss <Ed@Weiss.ca>", bulk: true, subject: "Weekly update" }), clients, []);
    expect(v?.bucket).toBe("client");
  });
  it("keeps firm mail with Rolf", () => expect(ruleVerdict(msg({ from: "a@prosperwise.ca" }), clients, [])?.bucket).toBe("needs_you"));
  it("archives bulk mail and muted senders", () => {
    expect(ruleVerdict(msg({ bulk: true }), clients, [])?.bucket).toBe("archivable");
    expect(ruleVerdict(msg({ from: "Deals <d@shop.com>" }), clients, ["shop.com"])?.bucket).toBe("archivable");
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
  it("computes accuracy", () => {
    const a = accuracy([{ bucket: "archivable", feedback: "right" }, { bucket: "archivable", feedback: "wrong" }, { bucket: "fyi", feedback: null }]);
    expect(a.overall).toEqual({ rated: 2, right: 1 });
    expect(accuracy([]).overall).toBeNull();
  });
});
