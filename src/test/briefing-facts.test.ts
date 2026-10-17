import { describe, it, expect } from "vitest";
import { classifyEmail, calendarConflicts, groupWeek } from "../../supabase/functions/_shared/briefing-facts";

describe("what an email is", () => {
  it("recognises iA business-tracker notices and Adobe Sign by sender", () => {
    expect(classifyEmail({ from: "iA Financial Group <noreply@inalco.com>", subject: "Business Tracker update" })).toBe("ia_notice");
    expect(classifyEmail({ from: "Adobe Sign <adobesign@adobesign.com>", subject: "Please sign" })).toBe("adobe_sign");
  });
  it("calls obvious junk spam, and Gmail's own labels count", () => {
    expect(classifyEmail({ from: "x@y.com", subject: "Guest post opportunity and backlinks for you" })).toBe("spam");
    expect(classifyEmail({ from: "x@y.com", subject: "hello", labels: ["SPAM"] })).toBe("spam");
    expect(classifyEmail({ from: "x@y.com", subject: "20% off", labels: ["CATEGORY_PROMOTIONS"] })).toBe("promo");
  });
  it("leaves a client's email alone", () => {
    expect(classifyEmail({ from: "Jane Client <jane@gmail.com>", subject: "Question about my RRSP", snippet: "Hi Rolf" })).toBe("other");
  });
});

describe("the calendar", () => {
  const ev = (summary: string, start: string, end: string | null, allDay = false) => ({ summary, start, end, allDay });
  it("finds overlapping timed events, and ignores back-to-back and all-day ones", () => {
    const c = calendarConflicts([
      ev("Client A", "2026-10-19T17:00:00Z", "2026-10-19T18:00:00Z"),
      ev("Client B", "2026-10-19T17:30:00Z", "2026-10-19T18:30:00Z"),
      ev("Lunch", "2026-10-19T18:30:00Z", "2026-10-19T19:30:00Z"),
      ev("Holiday", "2026-10-19", null, true),
    ]);
    expect(c).toEqual([{ a: "Client A", b: "Client B", at: "2026-10-19T17:30:00Z" }]);
  });
  it("groups the days after today", () => {
    const toDate = (iso: string) => iso.slice(0, 10);
    const w = groupWeek([ev("Today", "2026-10-19T17:00:00Z", null), ev("Wed", "2026-10-21T17:00:00Z", null), ev("Tue", "2026-10-20T17:00:00Z", null), ev("Tue all-day", "2026-10-20", null, true)], "2026-10-19", toDate);
    expect(w.map((d) => d.date)).toEqual(["2026-10-20", "2026-10-21"]);
    expect(w[0].items).toHaveLength(2);
  });
});

import { sectionsFromEmails } from "../../supabase/functions/_shared/briefing-facts";
describe("the email lists in the briefing", () => {
  const m = (id: string, from: string, subject: string, labels: string[] = []) => ({ id, from, subject, snippet: "", labels, link: `https://mail/${id}` });
  it("keeps spam and promotions out of the lists but counts them, and separates iA and Adobe Sign items", () => {
    const s = sectionsFromEmails([
      m("1", "Jane <jane@gmail.com>", "RRSP question"),
      m("2", "iA <noreply@inalco.com>", "Business Tracker update"),
      m("3", "Adobe Sign <adobesign@adobesign.com>", "Completed: Charter"),
      m("4", "x@y.com", "SEO services for your site"),
      m("5", "shop@z.com", "Sale", ["CATEGORY_PROMOTIONS"]),
    ], 4);
    expect(s.replies.map((r) => r.subject)).toEqual(["RRSP question"]);
    expect(s.ia.map((i) => i.kind)).toEqual(["ia_notice", "adobe_sign"]);
    expect(s.counts).toEqual({ spam: 1, promo: 1, automated: 0, adminTotal: 4 });
  });
});

describe("newsletters and automated mail", () => {
  it("treats marketing mail as a promotion even from iA, but keeps Adobe Sign", () => {
    expect(classifyEmail({ from: "iA Financial Group <web@mail-corpo.ia.ca>", subject: "Stay in step with the economy!", bulk: true })).toBe("promo");
    expect(classifyEmail({ from: "Adobe Sign <adobesign@adobesign.com>", subject: "Signature requested", bulk: true })).toBe("adobe_sign");
    expect(classifyEmail({ from: "iA Financial Group <noreply@inalco.com>", subject: "Business Tracker update" })).toBe("ia_notice");
  });
  it("leaves automated notices out of the replies list", () => {
    expect(classifyEmail({ from: "Venn <no-reply@venn.ca>", subject: "Funds have landed" })).toBe("automated");
    expect(classifyEmail({ from: "Dext <no-reply@notifications.app.dext.com>", subject: "Summary of account activity" })).toBe("automated");
    expect(classifyEmail({ from: "Jane Client <jane@gmail.com>", subject: "Question" })).toBe("other");
  });
});
