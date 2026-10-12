import { describe, it, expect } from "vitest";
import { cleanReply, isAutomatic, replyAction, inboundReplies, parseClassification, classifierPrompt, hasRisk } from "../../supabase/functions/_shared/onboarding-replies";
import { b64urlDecode, extractPlainText, normalizeMessage } from "../../supabase/functions/_shared/gmail-read";
import { decideNext, escalationBody, DEFAULT_CONFIG, type CaseFacts } from "../../supabase/functions/_shared/onboarding-agent";

const enc = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const msg = (o: any = {}) => ({ id: "m1", from: "Sam <sam@example.com>", subject: "Re: Your next step", labelIds: ["INBOX"], internalDate: 1, headers: {}, text: "Thanks", ...o });

describe("cleanReply", () => {
  it("keeps only the new text", () => {
    expect(cleanReply("Thanks, will do!\n\nOn Tue, Oct 13, 2026 at 9:00 AM Georgia wrote:\n> Hi Sam\n> your next step")).toBe("Thanks, will do!");
    expect(cleanReply("Got it\n> quoted\nSent from my iPhone\nsecret footer")).toBe("Got it");
    expect(cleanReply("Yes\n-----Original Message-----\nFrom: x@y.com")).toBe("Yes");
  });
  it("caps the length", () => { expect(cleanReply("a".repeat(5000)).length).toBe(1200); });
});

describe("automatic mail is not a reply", () => {
  it("recognises out-of-office, bounces and bulk mail", () => {
    expect(isAutomatic(msg({ headers: { "auto-submitted": "auto-replied" } }))).toBe(true);
    expect(isAutomatic(msg({ headers: { precedence: "bulk" } }))).toBe(true);
    expect(isAutomatic(msg({ subject: "Automatic reply: Away" }))).toBe(true);
    expect(isAutomatic(msg({ from: "Mail Delivery Subsystem <mailer-daemon@googlemail.com>" }))).toBe(true);
    expect(isAutomatic(msg())).toBe(false);
  });
});

describe("what to do with a reply", () => {
  it("pauses only for a short, plain acknowledgement", () => {
    expect(replyAction("acknowledged", "Thanks, will do this week.")).toEqual({ kind: "snooze", days: 3 });
    expect(replyAction("acknowledged", "Thanks, when is the session?")).toEqual({ kind: "escalate", reason: "client_replied" });
    expect(replyAction("acknowledged", "x".repeat(400))).toEqual({ kind: "escalate", reason: "client_replied" });
  });
  it("hands anything else to a person, and never trusts the model over a risk word", () => {
    for (const i of ["question", "concern", "wants_person", "other"] as const) expect(replyAction(i, "ok").kind).toBe("escalate");
    expect(replyAction("acknowledged", "Thanks, my lawyer will look at it.")).toEqual({ kind: "escalate", reason: "client_replied" });
    expect(hasRisk("we are going through a divorce")).toBe(true);
    expect(hasRisk("sounds good")).toBe(false);
  });
  it("honours a request to stop", () => {
    expect(replyAction("stop", "please stop")).toEqual({ kind: "escalate", reason: "asked_to_stop" });
    expect(replyAction("other", "Please unsubscribe me")).toEqual({ kind: "escalate", reason: "asked_to_stop" });
  });
  it("treats an unreadable classification as 'other'", () => {
    expect(parseClassification({ intent: "bogus" }).intent).toBe("other");
    expect(parseClassification(null)).toEqual({ intent: "other", summary: "" });
    expect(parseClassification({ intent: "question", summary: "Asks when." })).toEqual({ intent: "question", summary: "Asks when." });
  });
  it("shows the model only the scrubbed reply", () => {
    expect(classifierPrompt("hello")).toContain("hello");
  });
});

describe("finding replies in a thread", () => {
  it("separates the client from the people at the firm, and skips what we sent or already handled", () => {
    const sent = msg({ id: "sent", labelIds: ["SENT"], internalDate: 1 });
    const client = msg({ id: "c1", internalDate: 3 });
    const staff = msg({ id: "s1", labelIds: ["SENT"], internalDate: 4 });
    const auto = msg({ id: "a1", internalDate: 5, subject: "Out of office" });
    const old = msg({ id: "c0", internalDate: 2 });
    const r = inboundReplies([staff, auto, client, old, sent], { sentIds: ["sent"], handledIds: ["c0"] });
    expect(r.client.map((m) => m.id)).toEqual(["c1"]);
    expect(r.staff.map((m) => m.id)).toEqual(["s1"]);
  });
});

describe("gmail parsing", () => {
  it("decodes base64url and prefers the plain text part", () => {
    expect(b64urlDecode(enc("Hello — world"))).toBe("Hello — world");
    const payload = { mimeType: "multipart/alternative", parts: [{ mimeType: "text/html", body: { data: enc("<p>HTML</p>") } }, { mimeType: "text/plain", body: { data: enc("Plain") } }] };
    expect(extractPlainText(payload)).toBe("Plain");
    expect(extractPlainText({ mimeType: "text/html", body: { data: enc("<p>Hi&nbsp;there</p>") } })).toBe("Hi there\n");
  });
  it("normalises a message", () => {
    const m = normalizeMessage({ id: "x", labelIds: ["INBOX"], internalDate: "5", payload: { mimeType: "text/plain", headers: [{ name: "From", value: "a@b.c" }, { name: "Subject", value: "Re: hi" }], body: { data: enc("ok") } } });
    expect(m).toMatchObject({ id: "x", from: "a@b.c", subject: "Re: hi", internalDate: 5, text: "ok" });
  });
});

describe("snooze in the decision", () => {
  const DAY = 86_400_000; const NOW = Date.parse("2026-10-14T17:00:00Z");
  const f = (o: Partial<CaseFacts> = {}): CaseFacts => ({ now: NOW, status: "active", enrolledAt: NOW - 9 * DAY, openedAt: NOW - 9 * DAY, surveyBooked: false, docsReceived: false, vaultProvisioned: true, vaultRetries: 0, hasEmail: true, openPortalRequest: false, lastClientActivityAt: null, nudgeCount: 1, lastNudgeAt: NOW - 3 * DAY, ...o });
  it("waits while snoozed, then carries on", () => {
    expect(decideNext(f({ snoozedUntil: NOW + DAY }), DEFAULT_CONFIG)).toEqual({ kind: "wait", reason: "snoozed" });
    expect(decideNext(f({ snoozedUntil: NOW - 1 }), DEFAULT_CONFIG).kind).toBe("nudge");
  });
  it("puts what the client wrote in the task for a person", () => {
    const body = escalationBody({ reason: "client_replied", detail: "The client replied to a reminder: Asks when.", label: "Smith", surveyBooked: false, docsReceived: false, nudges: 1, enrolledAt: NOW - DAY, now: NOW, replyPreview: "When is the session?" });
    expect(body).toContain('"When is the session?"');
    expect(body).toContain("Read the client's reply");
  });
});
