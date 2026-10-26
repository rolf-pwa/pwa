import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { withConversationSiblings, type Gm } from "../../supabase/functions/_shared/gmail-handled";

const res = (body: unknown, ok = true) => ({ ok, json: async () => body }) as Response;
// Thread t1: m1 (old, in the Inbox), m2 (newest, the one handled), m3 (starred, in the Inbox), m4 (already out of the Inbox and read).
const gm: Gm = async (path) => {
  if (path.startsWith("messages/m2")) return res({ id: "m2", threadId: "t1" });
  if (path.startsWith("messages/lone")) return res({ id: "lone", threadId: "t2" });
  if (path.startsWith("threads/t1")) return res({ messages: [{ id: "m1", labelIds: ["INBOX"] }, { id: "m2", labelIds: ["INBOX", "UNREAD"] }, { id: "m3", labelIds: ["INBOX", "STARRED"] }, { id: "m4", labelIds: ["SENT"] }] });
  if (path.startsWith("threads/t2")) return res({ messages: [{ id: "lone", labelIds: ["INBOX"] }] });
  return res({}, false);
};

describe("filing a handled email", () => {
  it("also files the older messages of its conversation that are still in the Inbox or unread, so the conversation leaves the Inbox", async () => {
    expect((await withConversationSiblings(gm, ["m2"])).sort()).toEqual(["m1", "m2"]);
  });
  it("never moves a starred message, nor one that is already out of the Inbox", async () => {
    const ids = await withConversationSiblings(gm, ["m2"]);
    expect(ids).not.toContain("m3");
    expect(ids).not.toContain("m4");
  });
  it("still files the message itself when its conversation cannot be read", async () => {
    const broken: Gm = async () => { throw new Error("network"); };
    expect(await withConversationSiblings(broken, ["m2"])).toEqual(["m2"]);
    expect(await withConversationSiblings(async () => res({}, false), ["x", "y"])).toEqual(["x", "y"]);
  });
  it("is used by all three places that file mail as handled", () => {
    for (const f of ["briefing-refresh", "ea-handlers", "notice-service"]) expect(readFileSync(`supabase/functions/_shared/${f}.ts`, "utf8"), f).toContain("withConversationSiblings(gm");
  });
});
