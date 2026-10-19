import { describe, it, expect } from "vitest";
import { decodeEid, extractEid, extractEmails, isNotesName, parseNextSteps, parseNotes, parseNotesName, section } from "../../supabase/functions/_shared/meeting-notes";
import { dueDateFor, followupAlreadyExists, identifyHousehold, nextSyncText, ownerIsRolf, renderRecapHtml, scrubText, taskTitleFor, validateDraft, type DraftModel } from "../../supabase/functions/_shared/meeting-followup";

describe("reading the notes' name", () => {
  it("gets the event title and start time (PDT is UTC-7)", () => {
    const n = parseNotesName("Interim Strategy Consultation (Shiven Khera) - 2026/10/13 12:00 PDT - Notes by Gemini")!;
    expect(n.eventTitle).toBe("Interim Strategy Consultation (Shiven Khera)");
    expect(n.startIso).toBe("2026-10-13T19:00:00.000Z");
    expect(n.ymd).toBe("2026-10-13");
  });
  it("handles winter time and a meeting with no event title", () => {
    expect(parseNotesName("Coffee - 2026/12/02 09:30 PST - Notes by Gemini")!.startIso).toBe("2026-12-02T17:30:00.000Z");
    const n = parseNotesName("Meeting started 2026/08/21 13:33 PDT - Notes by Gemini")!;
    expect(n.eventTitle).toBeNull();
    expect(n.startIso).toBe("2026-08-21T20:33:00.000Z");
  });
  it("ignores other documents", () => {
    expect(parseNotesName("Budget 2026")).toBeNull();
    expect(isNotesName("x - Notes by Gemini")).toBe(true);
    expect(isNotesName("x - Transcript")).toBe(false);
  });
});

describe("finding the calendar event", () => {
  it("reads the event link in the notes and decodes its id", () => {
    const html = '<a href="https://calendar.google.com/calendar/event?eid=anFkMTA1NXVuNGZ2czFrMWN0YW10b3A4Zmsgcm9sZkBwcm9zcGVyd2lzZS5jYQ">Interim Strategy</a>';
    const eid = extractEid(html)!;
    expect(decodeEid(eid)).toEqual({ eventId: "jqd1055un4fvs1k1ctamtop8fk", calendarId: "rolf@prosperwise.ca" });
  });
  it("copes with no link and with nonsense", () => {
    expect(extractEid("<p>no link</p>")).toBeNull();
    expect(decodeEid("%%%")).toBeNull();
    expect(decodeEid(btoa("not an id!"))).toBeNull();
  });
});

const PLAIN = [
  "Interim Strategy Consultation (Shiven Khera)", "Oct 13, 2026", "shiven@linkbase.ca Rolf Issler rolf@prosperwise.ca brandon@linkbase.ca", "",
  "Summary", "Company growth strategies", "",
  "Decisions", "Aligned", "Timeline for exit", "",
  "Next steps",
  "- [Rolf Issler] Send Diagnostic Materials: Send the email containing the diagnostic tool link.",
  "- [Shiven Khera, Brandon Caiza] Discuss Engagement Plan: Coordinate internally regarding the fee.",
  "",
  "Details", "Company Growth and Exit Goals: ...", "",
  "Transcript", "00:00:31", "Shiven Khera: Hi Rolf",
].join("\n");

describe("reading the notes", () => {
  it("finds the people invited, the owners in Next steps, and the sections", () => {
    const p = parseNotes(PLAIN, "");
    expect(p.invited).toEqual(["shiven@linkbase.ca", "rolf@prosperwise.ca", "brandon@linkbase.ca"]);
    expect(p.nextSteps).toEqual([
      { owners: ["Rolf Issler"], task: "Send Diagnostic Materials", detail: "Send the email containing the diagnostic tool link." },
      { owners: ["Shiven Khera", "Brandon Caiza"], task: "Discuss Engagement Plan", detail: "Coordinate internally regarding the fee." },
    ]);
    expect(section(PLAIN, "Summary", ["Decisions"])).toBe("Company growth strategies");
  });
  it("reads escaped brackets from exported text", () => {
    expect(parseNextSteps("  - \\[Rolf Issler\\] Send it: now")).toEqual([{ owners: ["Rolf Issler"], task: "Send it", detail: "now" }]);
  });
  it("finds emails once, lower-cased", () => {
    expect(extractEmails("A@x.com, a@x.com <B@Y.ca>")).toEqual(["a@x.com", "b@y.ca"]);
  });
});

describe("which household a meeting belongs to", () => {
  const contacts = [
    { id: "c1", email: "colleen@example.com", household_id: "h1", family_role: "head_of_family" },
    { id: "c2", email: "kaelen@example.com", household_id: "h1", family_role: "beneficiary" },
    { id: "c3", email: "ed@example.com", household_id: "h2", family_role: "spouse" },
  ];
  it("matches on the household's people and picks the head as the primary", () => {
    const r = identifyHousehold(["kaelen@example.com", "COLLEEN@example.com", "rolf@prosperwise.ca"], contacts, "prosperwise.ca");
    expect(r.status).toBe("matched");
    if (r.status === "matched") { expect(r.householdId).toBe("h1"); expect(r.primary.id).toBe("c1"); }
  });
  it("calls a meeting with only staff internal, and one with strangers unmatched", () => {
    expect(identifyHousehold(["rolf@prosperwise.ca"], contacts, "prosperwise.ca").status).toBe("internal");
    expect(identifyHousehold(["shiven@linkbase.ca", "rolf@prosperwise.ca"], contacts, "prosperwise.ca").status).toBe("unmatched");
  });
  it("takes the household with the most people on the call", () => {
    const r = identifyHousehold(["colleen@example.com", "kaelen@example.com", "ed@example.com"], contacts, "prosperwise.ca");
    expect(r.status === "matched" && r.householdId).toBe("h1");
  });
});

describe("keeping to Rolf's rules in the text", () => {
  it("removes em-dashes and the verb forms of architect", () => {
    expect(scrubText("Good — that works—really").text).toBe("Good, that works, really");
    expect(scrubText("We are architecting a plan and architected the trust").text).toBe("We are designing a plan and designed the trust");
  });
  it("flags a bare 'architect' for a person to check", () => {
    expect(scrubText("Talk to the architect").flags).toHaveLength(1);
    expect(scrubText("All good").flags).toHaveLength(0);
  });
});

const raw = {
  executive_summary: ["We lined up the exit plan — early."],
  decisions: ["Aligned on a 2 to 3 year exit."],
  actions: [{ task: "Send diagnostic link", owner: "Rolf Issler", deadline: "2026-10-14" }, { task: "Discuss the plan", owner: "Shiven Khera", deadline: "next week" }, { task: "", owner: "x" }],
  preferences: [], insights: ["Start early."], framework_note: null, closing_question: "Whatever", missing_info: ["Owner of the invoice was not stated."],
};

describe("checking the model's draft", () => {
  it("cleans it up: scrubbed text, real dates only, a known check-in question, empty actions dropped", () => {
    const { draft, flags } = validateDraft(raw)!;
    expect(draft.executive_summary[0]).toBe("We lined up the exit plan, early.");
    expect(draft.actions).toEqual([{ task: "Send diagnostic link", owner: "Rolf Issler", deadline: "2026-10-14" }, { task: "Discuss the plan", owner: "Shiven Khera", deadline: null }]);
    expect(draft.closing_question).toBe("Would that be fair?");
    expect(flags).toEqual([]);
  });
  it("refuses an empty or malformed answer", () => {
    expect(validateDraft(null)).toBeNull();
    expect(validateDraft({ executive_summary: [], decisions: [], actions: [] })).toBeNull();
  });
});

describe("the recap in Rolf's template", () => {
  const draft = validateDraft(raw)!.draft;
  const html = renderRecapHtml(draft, "No next session is booked yet.");
  it("has the sections in his order and ends with the check-in and signature", () => {
    const order = ["Executive Summary", "Key Decisions Made", "The Action Plan", "Stakeholder Preferences Uncovered", "Strategic Insights &amp; Next Steps"].map((s) => html.indexOf(`<h4>${s}</h4>`));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html.startsWith("<h3>Recap: Our Conversation &amp; Next Steps</h3>")).toBe(true);
    expect(html).toContain("Would that be fair?");
    expect(html).toContain("Rolf Issler<br>Founder &amp; Family CFO | Prosperwise Advisors");
  });
  it("writes actions as task | person | deadline, and 'Date to confirm' when none was stated", () => {
    expect(html).toContain("<li>Send diagnostic link | Rolf Issler | 2026-10-14</li>");
    expect(html).toContain("<li>Discuss the plan | Shiven Khera | Date to confirm</li>");
  });
  it("puts the next session in the last section, and never shows what is for Rolf only", () => {
    expect(html).toContain("<li>No next session is booked yet.</li>");
    expect(html).not.toContain("Owner of the invoice");
    expect(html).not.toContain("—");
  });
  it("escapes anything from the model", () => {
    const d = { ...draft, decisions: ["<script>x()</script>"] };
    expect(renderRecapHtml(d, "x")).not.toContain("<script>");
  });
});

describe("the next session, the title and the due date", () => {
  it("names the next event that has the household on it, after the meeting", () => {
    const ev = [
      { summary: "Dentist", start: "2026-10-20T20:00:00Z", attendees: ["x@y.com"] },
      { summary: "Review", start: "2026-11-03T18:00:00Z", attendees: ["Colleen@example.com"] },
      { summary: "Earlier", start: "2026-10-01T18:00:00Z", attendees: ["colleen@example.com"] },
    ];
    expect(nextSyncText(ev, "2026-10-15T21:00:00Z", new Set(["colleen@example.com"]))).toBe("Our next strategic sync is Tuesday, November 3, 2026 at 10:00 am PST.");
    expect(nextSyncText([], "2026-10-15T21:00:00Z", new Set(["a@b.c"]))).toBe("No next session is booked yet.");
  });
  it("names the task after the meeting without the person in brackets", () => {
    expect(taskTitleFor("Interim Strategy Consultation (Shiven Khera)")).toBe("Interim Strategy Consultation Followup");
    expect(taskTitleFor("1. Networking-Coffee (Jayde Silva)")).toBe("Networking-Coffee Followup");
    expect(taskTitleFor(null)).toBe("Meeting Followup");
  });
  it("is due on the latest stated deadline, or a week after the meeting", () => {
    expect(dueDateFor(["2026-10-20", null, "2026-10-25"], "2026-10-15")).toBe("2026-10-25");
    expect(dueDateFor([null], "2026-10-15")).toBe("2026-10-22");
  });
  it("tells Rolf's actions from the client's", () => {
    expect(ownerIsRolf("Rolf Issler")).toBe(true);
    expect(ownerIsRolf("Shiven Khera")).toBe(false);
  });
});

describe("not duplicating a follow-up Rolf made by hand", () => {
  const start = "2026-10-15T20:00:00Z";
  it("sees one made after the meeting", () => {
    expect(followupAlreadyExists([{ title: "Governance Review Followup", meeting_followup: false, created_at: "2026-10-15T22:10:00Z" }], start)).toBe(true);
    expect(followupAlreadyExists([{ title: "Anything", meeting_followup: true, created_at: "2026-10-16T10:00:00Z" }], start)).toBe(true);
  });
  it("ignores unrelated or much later tasks", () => {
    expect(followupAlreadyExists([{ title: "Withdrawal", meeting_followup: false, created_at: "2026-10-15T22:10:00Z" }], start)).toBe(false);
    expect(followupAlreadyExists([{ title: "Review Followup", meeting_followup: false, created_at: "2026-11-15T22:10:00Z" }], start)).toBe(false);
  });
});

import { readFileSync } from "node:fs";
import { TOOL_DECLARATIONS } from "../../supabase/functions/_shared/ea-agent";

describe("what drafting can and cannot do", () => {
  const src = readFileSync("supabase/functions/_shared/meeting-followup-service.ts", "utf8");
  it("makes the task hidden and assigned to Rolf, and never shares or notifies a client", () => {
    expect(src).toContain("client_visible: false, meeting_followup: true");
    expect(src).toContain("assignee_id: rolfId");
    expect(src).not.toMatch(/notifyClientsOf|send-admin-email|gmail\.googleapis|notify-portal-request/);
    // Her private questions go in staff-only notes, never into a comment the client could see.
    expect(src).toContain("staff_notes: staffNotes");
    expect(src).not.toMatch(/body:\s*staffNotes/);
  });
  it("leaves the notes where they are and only copies them", () => {
    expect(src).toContain("/copy?");
    expect(src).not.toMatch(/method:\s*"DELETE"|files\/\$\{[^}]+\}\?supportsAllDrives=true"\s*,\s*\{\s*method:\s*"PATCH"/);
  });
  it("gives Georgia a way to draft an older meeting on request", () => {
    expect(TOOL_DECLARATIONS.map((t) => t.name)).toContain("draft_meeting_followup");
  });
});
