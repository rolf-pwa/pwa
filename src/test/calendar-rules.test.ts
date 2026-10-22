import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { clashes, mayAutoAccept, overlaps, type AcceptFacts } from "../../supabase/functions/_shared/calendar-rules";

const now = Date.parse("2026-10-22T17:00:00Z");
const base: AcceptFacts = { category: "webinar_or_training", confidence: "high", organizerKnown: false, startIso: "2026-10-28T18:00:00Z", endIso: "2026-10-28T19:00:00Z", nowMs: now, clashCount: 0, allDay: false };

describe("overlap and clashes", () => {
  it("counts real overlap, not back-to-back", () => {
    expect(overlaps({ start: "2026-10-28T18:00:00Z", end: "2026-10-28T19:00:00Z" }, { start: "2026-10-28T18:30:00Z", end: "2026-10-28T19:30:00Z" })).toBe(true);
    expect(overlaps({ start: "2026-10-28T18:00:00Z", end: "2026-10-28T19:00:00Z" }, { start: "2026-10-28T19:00:00Z", end: "2026-10-28T20:00:00Z" })).toBe(false);
  });
  it("lists the events that clash, not the invitation itself", () => {
    const inv = { id: "a", start: "2026-10-28T18:00:00Z", end: "2026-10-28T19:00:00Z", title: "Webinar" };
    const others = [inv, { id: "b", start: "2026-10-28T18:30:00Z", end: "2026-10-28T19:30:00Z", title: "Client call" }, { id: "c", start: "2026-10-29T18:00:00Z", end: "2026-10-29T19:00:00Z", title: "Other day" }];
    expect(clashes(inv, others).map((c) => c.title)).toEqual(["Client call"]);
  });
});

describe("when Georgia may accept an invitation herself", () => {
  it("accepts a clear webinar that fits", () => expect(mayAutoAccept(base)).toEqual({ accept: true }));
  it("never accepts a meeting with a person, something unclear, or mail from someone you know", () => {
    expect(mayAutoAccept({ ...base, category: "meeting_with_person" }).accept).toBe(false);
    expect(mayAutoAccept({ ...base, category: "sales_or_other" }).accept).toBe(false);
    expect(mayAutoAccept({ ...base, confidence: "medium" }).accept).toBe(false);
    expect(mayAutoAccept({ ...base, organizerKnown: true }).accept).toBe(false);
  });
  it("never accepts a clash, an all-day event, a long one, one already started, or one too far off", () => {
    expect(mayAutoAccept({ ...base, clashCount: 1 }).accept).toBe(false);
    expect(mayAutoAccept({ ...base, allDay: true }).accept).toBe(false);
    expect(mayAutoAccept({ ...base, endIso: "2026-10-28T22:00:00Z" }).accept).toBe(false);
    expect(mayAutoAccept({ ...base, startIso: "2026-10-22T16:00:00Z", endIso: "2026-10-22T17:30:00Z" }).accept).toBe(false);
    expect(mayAutoAccept({ ...base, startIso: "2027-02-01T18:00:00Z", endIso: "2027-02-01T19:00:00Z" }).accept).toBe(false);
  });
});

describe("the calendar plumbing", () => {
  const svc = readFileSync("supabase/functions/_shared/calendar-service.ts", "utf8");
  it("only ever accepts on its own: never declines, and tells the organizer nothing", () => {
    expect(svc).toContain('"accepted", false');
    expect(svc).not.toMatch(/"declined"\s*,\s*(true|false)\)/);
  });
  it("is on the 30 minute job, and Georgia can answer an invitation only when told", () => {
    expect(readFileSync("supabase/functions/daily-briefing-generate/index.ts", "utf8")).toContain('cronBody.job === "calendar_invites"');
    const agent = readFileSync("supabase/functions/_shared/ea-agent.ts", "utf8");
    expect(agent).toMatch(/respond_to_invite[\s\S]{0,300}Only when he has told you to/);
    expect(agent).toMatch(/you never decline on your own/);
  });
});
