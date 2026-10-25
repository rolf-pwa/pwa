// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildTiles, loadSeen, newKeys, saveSeen, watched, type LiveToday } from "@/modules/crm/lib/today";
import type { BriefingSections } from "../../supabase/functions/_shared/briefing-facts";

vi.mock("@/shared/integrations/supabase/client", () => ({ supabase: { functions: { invoke: vi.fn() }, channel: () => { const c: any = { on: () => c, subscribe: () => c }; return c; }, removeChannel: vi.fn() } }));
import { TodayTabs } from "@/modules/crm/components/TodayTabs";

const sections = (o: Partial<BriefingSections> = {}): BriefingSections => ({
  schedule: [], week: [], counts: { spam: 0, promo: 0, automated: 0, adminTotal: 0 },
  replies: [{ key: "email:1", from: "Jane Client <jane@x.ca>", subject: "RRSP question", link: "https://mail.google.com/mail/u/0/#all/1" }, { key: "email:2", from: "Someone <s@y.com>", subject: "Hello", link: "https://mail.google.com/mail/u/0/#all/2" }],
  ia: [{ key: "email:3", kind: "ia_notice", from: "iA", subject: "Business Tracker update", link: "https://mail.google.com/mail/u/0/#all/3" }],
  texts: [{ key: "quo:msg:old", label: "old text", contact: "Old Name", link: "/inbox" }],
  firm: [{ key: "esc:9", label: "Glanz: rebalancing handed to you", link: "/review-agent" }], ...o,
});
const live = (o: Partial<LiveToday> = {}): LiveToday => ({
  mailOk: true,
  texts: [{ key: "quo:msg:1", label: "Can you call me?", contact: "Sam Smith", contactId: "c1", link: "/inbox" }, { key: "quo:msg:2", label: "Who is this", contact: null, contactId: null, link: "/inbox" }, { key: "quo:call:3", label: "Voicemail", contact: "Lisa", contactId: "c2", link: "/inbox" }],
  requests: [{ key: "request:r1", contact: "Justin Santos", contactId: "c3", type: "tax_question", description: "Where is my slip?", created_at: "2026-10-25T00:00:00Z", link: "/requests" }],
  newReplies: [{ key: "email:9", from: "Pat <pat@z.ca>", subject: "New this afternoon", link: "https://mail.google.com/mail/u/0/#all/9" }], newIa: [],
  matches: { "email:1": { id: "c4", name: "Jane Client" } }, ...o,
});

const all = (t: { groups: { items: { key: string }[] }[] }) => t.groups.flatMap((g) => g.items.map((i) => i.key));
const lv = (o: Partial<LiveToday> = {}) => live({
  calendar: { schedule: [{ start: "2026-10-26T17:00:00Z", end: "2026-10-26T18:00:00Z", allDay: false, summary: "Client A", link: "https://calendar/1", conflict: true }, { start: "2026-10-26T19:00:00Z", end: null, allDay: false, summary: "Booked this morning", link: "https://calendar/2", conflict: false }], week: [{ date: "2026-10-28", items: [{ start: "2026-10-28T22:00:00Z", allDay: false, summary: "Board Meeting", link: null }] }] },
  tasks: { overdue: [{ id: "t1", title: "Send the transfer form", project: "Santos", due_date: "2026-10-22", link: "/contacts/c1" }], dueToday: [{ id: "t2", title: "Call Jane", project: null, link: null }], upcoming: [{ id: "t3", title: "Review the plan", project: "Plans", due_date: "2026-10-30", link: "/projects/p1" }], georgia: [{ id: "t4", title: "File the statements", project: null, link: null }] }, ...o,
});

describe("what the buttons show", () => {
  it("combines texts, mail to reply to and iA notices in Messages, using the live texts, adding mail since the briefing, and matching senders to clients", () => {
    const t = buildTiles(sections(), live());
    const [texts, replies, ia] = t.messages.groups;
    expect(texts.items.map((i) => i.key)).toEqual(["quo:msg:1", "quo:msg:2", "quo:call:3"]);
    expect(texts.items[0]).toMatchObject({ title: "Sam Smith", href: "/contacts/c1", contactId: "c1" });
    expect(texts.items[1]).toMatchObject({ title: "Unknown number", href: "/inbox" }); // no contact: the Inbox page
    expect(replies.items.map((i) => i.title)).toEqual(["RRSP question", "Hello", "New this afternoon"]);
    expect(replies.items[0]).toMatchObject({ contactId: "c4", contactName: "Jane Client", sub: "Jane Client" });
    expect(replies.items[1].contactId).toBeNull();
    expect(ia.items.map((i) => i.title)).toEqual(["Business Tracker update"]);
    expect(t.messages.count).toBe(7);
    expect(t.requests.groups[0].items[0]).toMatchObject({ title: "Justin Santos", href: "/contacts/c3" });
    expect(t.firm.groups[0].items[0]).toMatchObject({ title: "Glanz: rebalancing handed to you", href: "/review-agent" });
  });
  it("falls back to the briefing's own lists until the live ones load, and drops what was marked done", () => {
    const t = buildTiles(sections({ dismissed: ["email:2"] }), null);
    expect(t.messages.groups[0].items.map((i) => i.title)).toEqual(["Old Name"]);
    expect(t.messages.groups[1].items.map((i) => i.key)).toEqual(["email:1"]);
    expect(t.requests.count).toBe(0);
    expect(t.tasks.groups).toEqual([]);
  });
  it("shows the calendar as it is now (an event added since the morning appears), counting today's events", () => {
    const stored = sections({ schedule: [{ start: "2026-10-26T17:00:00Z", end: null, allDay: false, summary: "Client A", link: null, conflict: false }] });
    expect(buildTiles(stored, null).calendar.count).toBe(1);
    const t = buildTiles(stored, lv());
    expect(t.calendar.count).toBe(2);
    expect(t.calendar.groups.map((g) => g.label)).toEqual(["Today", "Wed, Oct 28"]);
    expect(t.calendar.groups[0].items[0]).toMatchObject({ title: "Client A", badge: "Overlaps", href: "https://calendar/1" });
  });
  it("counts overdue and due-today tasks, keeps the week and Georgia's own folded away, and opens the client or project", () => {
    const t = buildTiles(sections(), lv());
    expect(t.tasks.count).toBe(2);
    expect(t.tasks.groups.map((g) => [g.id, g.collapsed ?? false, g.watch ?? true])).toEqual([["overdue", false, true], ["due", false, true], ["week", true, false], ["georgia", true, false]]);
    expect(t.tasks.groups[0].items[0]).toMatchObject({ title: "Send the transfer form", badge: "Overdue", href: "/contacts/c1", sub: "Santos · due Thu, Oct 22" });
  });
  it("knows what is new: items whose keys were not seen, and nothing before anything has been remembered", () => {
    const items = watched(buildTiles(sections(), live()).messages);
    expect(newKeys(items, null)).toEqual([]);
    expect(newKeys(items, ["quo:msg:1"])).toContain("quo:msg:2");
    expect(newKeys(items, items.map((i) => i.key))).toEqual([]);
    // the rest of the week and Georgia's own tasks are for reference: they never light the button
    expect(watched(buildTiles(sections(), lv()).tasks).map((i) => i.key)).toEqual(["task:t1", "task:t2"]);
  });
});

// Radix tabs open on mouse down.
const pick = (id: string) => act(() => { fireEvent.mouseDown(screen.getByTestId(`tile-${id}`), { button: 0 }); });

describe("the tabs and what they show", () => {
  beforeEach(() => localStorage.clear());
  const show = (s = sections(), l: LiveToday | null = lv(), onDone = vi.fn(), at = "/") => { render(<MemoryRouter initialEntries={[at]}><TodayTabs sections={s} live={l} onDone={onDone} briefing={<p>THE BRIEFING</p>} aside={<p>THE CHAT</p>} /></MemoryRouter>); return onDone; };

  it("opens on the Briefing, with the chat beside it, and the five tabs with how many are open and no dots on the first visit", () => {
    show();
    expect(screen.getByText("THE BRIEFING")).toBeTruthy();
    expect(screen.getByText("THE CHAT")).toBeTruthy();
    expect(screen.getByTestId("tile-briefing").getAttribute("data-state")).toBe("active");
    for (const [id, n] of [["messages", "7"], ["requests", "1"], ["firm", "1"], ["calendar", "2"], ["tasks", "2"]]) expect(screen.getByTestId(`count-${id}`).textContent, id).toBe(n);
    for (const id of ["messages", "requests", "firm", "calendar", "tasks"]) expect(screen.queryByTestId(`new-${id}`), id).toBeNull();
  });
  it("opens at the tab named in the address", () => {
    show(sections(), lv(), vi.fn(), "/?tab=calendar");
    expect(screen.getByTestId("tile-calendar").getAttribute("data-state")).toBe("active");
    expect(screen.queryByText("THE BRIEFING")).toBeNull();
    expect(screen.getByTestId("group-today").textContent).toContain("Client A");
  });
  it("shows a tab's list in the page, not in a panel over it, and goes back to the Briefing", () => {
    show();
    pick("messages");
    expect(screen.queryByText("THE BRIEFING")).toBeNull();
    expect(screen.getByTestId("today-panel").textContent).toContain("Sam Smith");
    expect(screen.getByText("THE CHAT")).toBeTruthy(); // the chat stays beside every tab
    pick("briefing");
    expect(screen.getByText("THE BRIEFING")).toBeTruthy();
  });
  it("puts a dot on a tab when something new has arrived since it was last looked at, marks the new items while it is open, and clears the dot", () => {
    saveSeen("messages", ["quo:msg:1", "email:1", "email:2", "email:9", "email:3"]);
    saveSeen("requests", ["request:r1"]); saveSeen("firm", ["esc:9"]); saveSeen("calendar", []); saveSeen("tasks", ["task:t1", "task:t2"]);
    show();
    expect(screen.getByTestId("new-messages").getAttribute("title")).toBe("2 new"); // the other text and the voicemail
    expect(screen.getByTestId("new-calendar").getAttribute("title")).toBe("3 new"); // two today and one this week, none seen
    expect(screen.queryByTestId("new-tasks")).toBeNull();
    pick("messages");
    const rows = within(screen.getByTestId("group-texts")).getAllByTestId("today-item");
    expect(rows.map((r) => r.getAttribute("data-new"))).toEqual(["false", "true", "true"]); // marked while it is open
    expect(screen.queryByTestId("new-messages")).toBeNull(); // and the dot is gone
    expect(loadSeen("messages")).toContain("quo:call:3");
    pick("briefing"); pick("messages");
    expect(within(screen.getByTestId("group-texts")).getAllByTestId("today-item").map((r) => r.getAttribute("data-new"))).toEqual(["false", "false", "false"]); // seen
  });
  it("shows the three kinds of message in sections of one tab, with a link to the full inbox", () => {
    show();
    pick("messages");
    const panel = screen.getByTestId("today-panel");
    for (const g of ["texts", "replies", "ia"]) expect(within(panel).getByTestId(`group-${g}`)).toBeTruthy();
    expect(within(panel).getByText("Sam Smith").closest("a")?.getAttribute("href")).toBe("/contacts/c1");
    expect(within(panel).getByText("Unknown number").closest("a")?.getAttribute("href")).toBe("/inbox");
    expect(within(panel).getByTestId("open-full-inbox").getAttribute("href")).toBe("/inbox");
    expect(within(panel).getByText("RRSP question").closest("a")?.getAttribute("href")).toContain("mail.google.com");
    const links = within(panel).getAllByTestId("open-contact");
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute("href")).toBe("/contacts/c4");
  });
  it("opens the calendar with today first, overlaps flagged, then the week", () => {
    show();
    pick("calendar");
    const panel = screen.getByTestId("today-panel");
    expect(within(panel).getByTestId("group-today").textContent).toContain("Client A");
    expect(within(panel).getByText("Overlaps")).toBeTruthy();
    expect(within(panel).getByTestId("group-day:2026-10-28").textContent).toContain("Board Meeting");
  });
  it("opens tasks with overdue first, and folds the week and Georgia's tasks away", () => {
    show();
    pick("tasks");
    const panel = screen.getByTestId("today-panel");
    expect(within(panel).getByText("Send the transfer form").closest("a")?.getAttribute("href")).toBe("/contacts/c1");
    expect(within(panel).getByText("Overdue", { selector: "span" })).toBeTruthy();
    expect(within(panel).getByTestId("group-week").querySelector("details")).toBeTruthy();
    expect(within(panel).getByTestId("group-georgia").querySelector("details")).toBeTruthy();
  });
  it("marks an item done, and says so when a list is empty", () => {
    const onDone = show(sections({ ia: [], replies: [] }), lv({ requests: [], newReplies: [], texts: [{ key: "quo:msg:1", label: "Can you call me?", contact: "Sam Smith", contactId: "c1", link: "/inbox" }] }));
    pick("messages");
    fireEvent.click(within(screen.getByTestId("today-panel")).getAllByLabelText("Mark done")[0]);
    expect(onDone).toHaveBeenCalledWith("quo:msg:1");
    pick("requests");
    expect(within(screen.getByTestId("today-panel")).getByText("No client request is waiting on you.")).toBeTruthy();
  });
});

describe("the live Today action", () => {
  const fn = readFileSync("supabase/functions/daily-briefing-generate/index.ts", "utf8");
  it("reads texts, voicemails and requests live, carrying the contact, and only mail that arrived after the briefing", () => {
    expect(fn).toContain('body.action === "ea_today_live"');
    expect(fn).toContain("gatherQuoFacts(db, 15)");
    expect(fn).toContain("(e.at ?? 0) > generatedAt && !known.has(`email:${e.id}`)");
    expect(fn).toContain("contactId: r.contact_id ?? null");
    expect(fn).toContain("const voicemails = allCalls.filter");
    expect(fn).toContain("email.ilike.");
    // and the calendar as it is now, and tasks
    expect(fn).toContain("gatherCalendarFacts(token, todayStr)");
    expect(fn).toContain('.eq("assigned_agent_key", "georgia")');
    expect(fn).toContain("newReplies, newIa, matches, calendar, tasks,");
  });
  it("is polled every five minutes and refreshed when texts, calls or requests change", () => {
    const src = readFileSync("src/modules/crm/components/TodayTabs.tsx", "utf8");
    expect(src).toContain("5 * 60 * 1000");
    for (const t of ["quo_messages", "quo_calls", "portal_requests", "portal_request_messages"]) expect(src).toContain(`table: "${t}"`);
  });
});
