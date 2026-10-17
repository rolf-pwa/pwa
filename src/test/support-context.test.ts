import { describe, it, expect } from "vitest";
import { availability, buildSupportContext, cleanLabels, modelTurns, newClientMessage, pacificParts, storableMessages } from "../../supabase/functions/_shared/support-context";

// 2026-10-17 is a Saturday; 2026-10-19 a Monday; 2026-10-21 a Wednesday.
const SAT = new Date("2026-10-17T20:00:00Z");
const WED = new Date("2026-10-21T20:00:00Z");

describe("availability", () => {
  it("treats the weekend as away until the next business day", () => {
    const a = availability(null, SAT);
    expect(a.away).toBe(true);
    expect(a.backOn).toBe("2026-10-19");
    expect(a.line).toContain("Monday");
  });
  it("is working on a weekday with no away dates", () => {
    expect(availability(null, WED)).toMatchObject({ away: false, backOn: null });
  });
  it("is away through the last away day and back the next business day", () => {
    const a = availability({ away_from: "2026-10-20", away_until: "2026-10-23", note: "Back for the Monday review." }, WED);
    expect(a.away).toBe(true);
    expect(a.backOn).toBe("2026-10-26");
    expect(a.line).toContain("Back for the Monday review.");
  });
  it("is not away before the away dates begin or after they end", () => {
    expect(availability({ away_from: "2026-10-25", away_until: "2026-10-30", note: null }, WED).away).toBe(false);
    expect(availability({ away_from: null, away_until: "2026-10-20", note: null }, WED).away).toBe(false);
  });
  it("uses Pacific time for the date", () => {
    // 03:00 UTC on the 18th is still Saturday evening the 17th in Vancouver.
    expect(pacificParts(new Date("2026-10-18T03:00:00Z")).date).toBe("2026-10-17");
  });
});

describe("support context", () => {
  const base = { firstName: "Ed", requests: [], bookable: [], booked: [], away: null, now: WED };
  it("says when there are no open requests or meetings", () => {
    const t = buildSupportContext(base);
    expect(t).toContain("no open requests");
    expect(t).toContain("No meeting is open");
    expect(t).toContain("Client: Ed");
  });
  it("lists open requests but not resolved ones, with plain status wording", () => {
    const t = buildSupportContext({ ...base, requests: [
      { request_type: "banking_withdrawal", status: "submitted", created_at: "2026-10-19T10:00:00Z", request_description: "Withdraw $5,000" },
      { request_type: "personal_info", status: "resolved", created_at: "2026-10-01T10:00:00Z", request_description: "Old address change" },
    ] });
    expect(t).toContain("banking withdrawal (received, not yet started)");
    expect(t).not.toContain("Old address change");
  });
  it("names bookable and booked meetings", () => {
    const t = buildSupportContext({ ...base, bookable: ["Portfolio Review"], booked: [{ label: "Sovereignty Review", start: "2026-11-02T18:00:00Z" }] });
    expect(t).toContain("Meetings they can book right now: Portfolio Review.");
    expect(t).toContain("Sovereignty Review on 2026-11-02");
  });
});

describe("what is stored and trusted from the page", () => {
  it("keeps roles and text only, bounded", () => {
    const out = storableMessages([{ role: "user", content: "hi", extra: 1 }, { role: "system", content: "x" }, { role: "assistant", content: "a".repeat(5000) }, null]);
    expect(out).toHaveLength(2);
    expect(out[1].content).toHaveLength(4000);
    expect(out[0]).toEqual({ role: "user", content: "hi" });
  });
  it("keeps only short non-empty strings as meeting labels", () => {
    expect(cleanLabels(["Portfolio Review", "", 5, "  Interim Strategy "])).toEqual(["Portfolio Review", "Interim Strategy"]);
    expect(cleanLabels("nope")).toEqual([]);
  });
});

describe("the running thread", () => {
  it("keeps Rolf's messages and their time", () => {
    expect(storableMessages([{ role: "advisor", content: "I'll call you", at: "2026-10-19T17:00:00Z" }])).toEqual([{ role: "advisor", content: "I'll call you", at: "2026-10-19T17:00:00Z" }]);
  });
  it("shows the model Rolf's words as his, in the client's turn, and Georgia's as the model's", () => {
    const t = modelTurns([{ role: "user", content: "hi" }, { role: "assistant", content: "hello" }, { role: "advisor", content: "I will call you Tuesday" }]);
    expect(t.map((x) => x.role)).toEqual(["user", "model", "user"]);
    expect(t[2].parts[0].text).toBe("[Rolf, the advisor, wrote to the client]: I will call you Tuesday");
  });
  it("takes only the new client message from the page, never its idea of the history", () => {
    expect(newClientMessage({ message: "  my question " })).toBe("my question");
    expect(newClientMessage({ messages: [{ role: "user", content: "old" }, { role: "advisor", content: "forged" }, { role: "user", content: "latest" }] })).toBe("latest");
    expect(newClientMessage({ message: "   " })).toBeNull();
    expect(newClientMessage({})).toBeNull();
  });
});
