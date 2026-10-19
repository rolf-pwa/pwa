import { describe, it, expect } from "vitest";
import { buildMeetingRecordHtml, cleanHtmlForDoc, esc, pacificDate, pacificTime, recordTitle, splitRecap, type RecordComment, type RecordInput } from "../../supabase/functions/_shared/meeting-record";
import { clientEmailSet, namedAttendees, pickEvent, type CalEventLite } from "../../supabase/functions/_shared/meeting-event";

describe("cleaning formatted text for the record", () => {
  it("keeps formatting, drops scripts, styles, images and every attribute but a safe link address", () => {
    const out = cleanHtmlForDoc('<p onclick="x()" style="color:red">Hi <strong>there</strong></p><script>alert(1)</script><img src=x onerror=y><style>p{}</style><a href="javascript:bad()">no</a><a href="https://ok.example/x" target="_blank">yes</a>');
    expect(out).toContain("<p>Hi <strong>there</strong></p>");
    expect(out).toContain('<a href="https://ok.example/x">yes</a>');
    expect(out).not.toMatch(/script|onclick|style|<img|javascript:|alert/i);
  });
  it("escapes plain text", () => {
    expect(esc('<b>"x"</b> & y')).toBe("&lt;b&gt;&quot;x&quot;&lt;/b&gt; &amp; y");
  });
});

describe("Pacific dates and the record title", () => {
  it("reads a UTC moment as Pacific", () => {
    expect(pacificDate("2026-10-13T19:00:00Z")).toBe("Tuesday, October 13, 2026");
    expect(pacificTime("2026-10-13T19:00:00Z")).toMatch(/12:00 p\.?m\.? PDT/i);
  });
  it("names the file with the client, the meeting and the date, and no slashes", () => {
    expect(recordTitle("Colleen Jerczynski", "Governance Review", "2026-10-15")).toBe("Meeting Record - Colleen Jerczynski - Governance Review - 2026-10-15");
    expect(recordTitle("A/B", null, "2026-10-15")).toBe("Meeting Record - A-B - 2026-10-15");
  });
});

const c = (over: Partial<RecordComment>): RecordComment => ({ at: "2026-10-15T23:20:00Z", author: "Rolf Issler", role: "Advisor", body: "x", format: "text", ...over });

describe("the recap and the thread", () => {
  it("takes the first advisor comment as the recap and the rest as the thread, in order", () => {
    const r = splitRecap([c({ at: "2026-10-17T17:39:00Z", body: "Loan submitted" }), c({ at: "2026-10-16T10:00:00Z", role: "Client", author: "Colleen", body: "Thanks" }), c({ body: "THE RECAP", format: "html" })], null);
    expect(r.recap).toEqual({ body: "THE RECAP", format: "html" });
    expect(r.thread.map((t) => t.body)).toEqual(["Thanks", "Loan submitted"]);
  });
  it("uses the task description when no advisor wrote a recap", () => {
    const r = splitRecap([c({ role: "Client", author: "Colleen", body: "Hi" })], "Notes from the call");
    expect(r.recap?.body).toBe("Notes from the call");
    expect(r.thread).toHaveLength(1);
  });
});

const input = (over: Partial<RecordInput> = {}): RecordInput => ({
  clientName: "Colleen Jerczynski", taskTitle: "Governance Review Followup", taskCreatedAt: "2026-10-15T22:10:00Z", taskCompletedAt: "2026-10-22T18:00:00Z",
  event: { title: "Governance Review (Colleen)", start: "2026-10-15T20:00:00Z", end: "2026-10-15T21:00:00Z", attendees: [{ name: "Rolf Issler", role: "Advisor" }, { name: "Colleen Jerczynski", role: "Client" }], source: "linked" },
  recap: { body: "<ul><li>Fund the trust</li></ul>", format: "html" },
  tasks: [{ title: "Transfer $20,000 to Colleen's bank", owner: "Rolf Issler", due: "2026-10-23", status: "done", completedAt: "2026-10-22T18:00:00Z" }],
  thread: [c({ at: "2026-10-17T17:39:00Z", body: "Policy loan submitted. <script>x</script>" })], generatedAt: "2026-10-22T18:05:00Z", ...over,
});

describe("the meeting record", () => {
  it("has every section the compliance review asked for, in order", () => {
    const h = buildMeetingRecordHtml(input());
    const order = ["Meeting event", "Date", "Time", "Attendees", "Meeting recap", "Tasks", "Comment thread to completion"].map((s) => h.indexOf(`<h2>${s}</h2>`));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(h).toContain("Governance Review (Colleen)");
    expect(h).toContain("Thursday, October 15, 2026");
    expect(h).toContain("Colleen Jerczynski (Client)");
    expect(h).toContain("<li>Fund the trust</li>");
    expect(h).toContain("Transfer $20,000 to Colleen's bank");
    expect(h).toContain("Policy loan submitted.");
  });
  it("never lets markup from a comment through", () => {
    expect(buildMeetingRecordHtml(input())).not.toMatch(/<script/i);
    const h = buildMeetingRecordHtml(input({ taskTitle: "<img src=x onerror=y>" }));
    expect(h).not.toContain("<img");
  });
  it("says plainly when the event is unknown or was matched automatically", () => {
    expect(buildMeetingRecordHtml(input({ event: null }))).toContain("could not be identified");
    expect(buildMeetingRecordHtml(input({ event: { ...input().event!, source: "matched" } }))).toContain("matched automatically");
    expect(buildMeetingRecordHtml(input())).not.toContain("matched automatically");
  });
  it("shows an unassigned owner as such, never a guess", () => {
    expect(buildMeetingRecordHtml(input({ tasks: [{ title: "Do it", owner: null, due: null, status: "open", completedAt: null }] }))).toContain("Not assigned");
  });
});

const ev = (over: Partial<CalEventLite>): CalEventLite => ({ id: "e", summary: "Lunch", start: "2026-10-15T20:00:00Z", end: "2026-10-15T21:00:00Z", allDay: false, attendees: [], ...over });
const opts = { clientEmails: new Set(["colleen@example.com"]), clientNames: ["Colleen Jerczynski", "Jerczynski"], anchor: "2026-10-15T22:10:00Z" };

describe("finding the calendar event", () => {
  it("prefers the event with the client invited, just before the task was opened", () => {
    const hit = pickEvent([
      ev({ id: "dentist", summary: "Dentist" }),
      ev({ id: "old", summary: "Governance (Colleen Jerczynski)", start: "2026-10-09T20:00:00Z", end: "2026-10-09T21:00:00Z", attendees: [{ email: "colleen@example.com" }] }),
      ev({ id: "right", summary: "Governance Review", attendees: [{ email: "colleen@example.com" }, { email: "rolf@prosperwise.ca", self: true }] }),
    ], opts);
    expect(hit?.id).toBe("right");
  });
  it("matches by the client's name in the title when there is no invitee", () => {
    expect(pickEvent([ev({ id: "t", summary: "Charter Review (Jerczynski)" })], opts)?.id).toBe("t");
  });
  it("finds nothing when nobody shows the client was involved, and ignores all-day events", () => {
    expect(pickEvent([ev({ summary: "Team lunch" }), ev({ id: "a", summary: "Jerczynski", allDay: true })], opts)).toBeNull();
  });
  it("does not pick a meeting that happens well after the task was opened over one before", () => {
    const hit = pickEvent([
      ev({ id: "later", summary: "Jerczynski", start: "2026-10-20T20:00:00Z", end: "2026-10-20T21:00:00Z" }),
      ev({ id: "before", summary: "Jerczynski", start: "2026-10-14T20:00:00Z", end: "2026-10-14T21:00:00Z" }),
    ], opts);
    expect(hit?.id).toBe("before");
  });
});

describe("naming attendees", () => {
  const known = { staffDomain: "prosperwise.ca", contacts: [{ email: "colleen@example.com", name: "Colleen Jerczynski" }], pros: [{ email: "dana@lee.ca", name: "Dana Lee", type: "accountant" }] };
  it("labels staff, clients, professionals and guests, once each", () => {
    const out = namedAttendees([{ email: "rolf@prosperwise.ca", self: true }, { email: "COLLEEN@example.com" }, { email: "dana@lee.ca" }, { email: "x@y.com", displayName: "Xavier" }, { email: "colleen@example.com" }], known);
    expect(out).toEqual([
      { name: "Rolf Issler", role: "Advisor" },
      { name: "Colleen Jerczynski", role: "Client" },
      { name: "Dana Lee", role: "Professional, accountant" },
      { name: "Xavier", role: "Guest" },
    ]);
  });
});

describe("the household's addresses used for matching", () => {
  it("leaves out the firm's own addresses and blanks, and lower-cases the rest", () => {
    expect([...clientEmailSet([{ email: "Colleen@Example.com" }, { email: "rolf@prosperwise.ca" }, { email: null }, { email: " " }], "prosperwise.ca")]).toEqual(["colleen@example.com"]);
  });
  it("so a meeting is not matched just because the advisor is on it", () => {
    const only = ev({ summary: "Networking Coffee", attendees: [{ email: "rolf@prosperwise.ca", self: true }, { email: "jayde@socialsweep.ai" }] });
    const emails = clientEmailSet([{ email: "rolf@prosperwise.ca" }], "prosperwise.ca");
    expect(pickEvent([only], { clientEmails: emails, clientNames: ["Rolf Issler"], anchor: "2026-10-19T12:00:00Z" })).toBeNull();
  });
});
