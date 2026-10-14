import { describe, it, expect } from "vitest";
import { decideNext, nextNudgeCount, withinSendWindow, nudgeEmail, escalationBody, DEFAULT_CONFIG, type CaseFacts } from "../../supabase/functions/_shared/onboarding-agent";

// 2026-10-14 is a Wednesday. 17:00 UTC = 10:00 Pacific (PDT).
const WED_10AM = Date.parse("2026-10-14T17:00:00Z");
const DAY = 86_400_000;
const base = (o: Partial<CaseFacts> = {}): CaseFacts => ({
  now: WED_10AM, status: "active", enrolledAt: WED_10AM - 2 * DAY, openedAt: WED_10AM - 2 * DAY, surveyBooked: false, docsReceived: false,
  vaultProvisioned: true, vaultRetries: 0, hasEmail: true, openPortalRequest: false, lastClientActivityAt: null, nudgeCount: 0, lastNudgeAt: null, ...o,
});

describe("onboarding concierge decisions", () => {
  it("is complete only when the Survey Session is booked and documents are received", () => {
    expect(decideNext(base({ surveyBooked: true, docsReceived: true }))).toEqual({ kind: "complete" });
    expect(decideNext(base({ surveyBooked: true })).kind).toBe("nudge");
    expect(decideNext(base({ docsReceived: true })).kind).toBe("nudge");
  });
  it("leaves finished, escalated and paused cases alone", () => {
    for (const status of ["complete", "escalated", "paused"] as const) expect(decideNext(base({ status })).kind).toBe("wait");
  });
  it("waits for the first reminder, then sends one for the right step", () => {
    expect(decideNext(base({ enrolledAt: WED_10AM - 3_600_000, openedAt: WED_10AM - 3_600_000 }))).toEqual({ kind: "wait", reason: "not_due" });
    expect(decideNext(base())).toEqual({ kind: "nudge", step: "documents" });
    expect(decideNext(base({ docsReceived: true }))).toEqual({ kind: "nudge", step: "survey" });
  });
  it("spaces later reminders at least the minimum gap apart", () => {
    expect(decideNext(base({ nudgeCount: 1, lastNudgeAt: WED_10AM - DAY }))).toEqual({ kind: "wait", reason: "not_due" });
    expect(decideNext(base({ nudgeCount: 1, lastNudgeAt: WED_10AM - 3 * DAY })).kind).toBe("nudge");
  });
  it("escalates, rather than nudging again, once the limit is reached", () => {
    const d = decideNext(base({ nudgeCount: 4, lastNudgeAt: WED_10AM - 3 * DAY }));
    expect(d.kind).toBe("escalate");
    if (d.kind === "escalate") expect(d.reason).toBe("no_response");
  });
  it("starts the count over when the client does something after a reminder", () => {
    const f = base({ nudgeCount: 4, lastNudgeAt: WED_10AM - 6 * DAY, lastClientActivityAt: WED_10AM - 3 * DAY });
    expect(decideNext(f).kind).toBe("nudge");
    expect(nextNudgeCount(f)).toBe(1);
    expect(nextNudgeCount(base({ nudgeCount: 2, lastNudgeAt: WED_10AM - 3 * DAY }))).toBe(3);
  });
  it("stays quiet while a person is handling a message from the client", () => {
    expect(decideNext(base({ openPortalRequest: true }))).toEqual({ kind: "wait", reason: "client_message_open" });
  });
  it("only contacts people on weekdays during business hours, Pacific time", () => {
    expect(withinSendWindow(WED_10AM, DEFAULT_CONFIG)).toBe(true);
    expect(withinSendWindow(Date.parse("2026-10-14T05:00:00Z"), DEFAULT_CONFIG)).toBe(false); // 22:00 Tue
    expect(withinSendWindow(Date.parse("2026-10-17T17:00:00Z"), DEFAULT_CONFIG)).toBe(false); // Saturday
    expect(decideNext(base({ now: Date.parse("2026-10-17T17:00:00Z"), enrolledAt: Date.parse("2026-10-10T17:00:00Z"), openedAt: Date.parse("2026-10-10T17:00:00Z") }))).toEqual({ kind: "wait", reason: "outside_send_window" });
  });
  it("gives the Vault time, retries it, then escalates", () => {
    const fresh = base({ vaultProvisioned: false, enrolledAt: WED_10AM - 600_000 });
    expect(decideNext(fresh)).toEqual({ kind: "wait", reason: "vault_building" });
    expect(decideNext(base({ vaultProvisioned: false }))).toEqual({ kind: "retry_vault" });
    const d = decideNext(base({ vaultProvisioned: false, vaultRetries: 2 }));
    expect(d.kind === "escalate" && d.reason).toBe("vault_failed");
  });
  it("escalates when there is nobody to email", () => {
    const d = decideNext(base({ hasEmail: false }));
    expect(d.kind === "escalate" && d.reason).toBe("no_email");
  });
});

describe("onboarding messages", () => {
  it("is signed as the AI assistant, names only the next step and carries no tokens or document details", () => {
    for (const step of ["survey", "documents"] as const) {
      const { subject, html } = nudgeEmail("Sam", step);
      expect(html).toContain("AI Assistant");
      expect(html).toContain("https://app.prosperwise.ca/portal");
      expect(html).toContain("automated email from Georgia, Rolf's AI Assistant");
      expect(html).toContain("just reply to this email");
      expect(html).not.toMatch(/token|statement|missing|passport|tax return/i);
      expect(subject).not.toMatch(/missing/i);
    }
  });
  it("escapes the client's name", () => {
    expect(nudgeEmail("<b>x</b>", "survey").html).not.toContain("<b>x</b>");
  });
  it("gives a person what they need to act", () => {
    const t = escalationBody({ reason: "no_response", detail: "d", label: "Smith", surveyBooked: false, docsReceived: true, nudges: 4, enrolledAt: WED_10AM - 9 * DAY, now: WED_10AM });
    expect(t).toContain("enrolled 9 days ago");
    expect(t).toContain("Reminders sent: 4");
    expect(t).toContain("Georgia has stopped contacting this client");
  });
});
