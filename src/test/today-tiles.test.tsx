// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildTiles, loadSeen, newKeys, saveSeen, type LiveToday } from "@/modules/crm/lib/today";
import type { BriefingSections } from "../../supabase/functions/_shared/briefing-facts";

vi.mock("@/shared/integrations/supabase/client", () => ({ supabase: { functions: { invoke: vi.fn() }, channel: () => { const c: any = { on: () => c, subscribe: () => c }; return c; }, removeChannel: vi.fn() } }));
import { TodayTiles } from "@/modules/crm/components/TodayTiles";

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

describe("what the buttons show", () => {
  it("uses the live texts and requests, adds mail that arrived since the briefing, and matches senders to clients", () => {
    const t = buildTiles(sections(), live());
    expect(t.texts.map((i) => i.key)).toEqual(["quo:msg:1", "quo:msg:2", "quo:call:3"]);
    expect(t.texts[0]).toMatchObject({ title: "Sam Smith", href: "/contacts/c1", contactId: "c1" });
    expect(t.texts[1]).toMatchObject({ title: "Unknown number", href: "/inbox" }); // no contact: the Inbox page
    expect(t.requests[0]).toMatchObject({ title: "Justin Santos", href: "/contacts/c3" });
    expect(t.replies.map((i) => i.title)).toEqual(["RRSP question", "Hello", "New this afternoon"]);
    expect(t.replies[0]).toMatchObject({ contactId: "c4", contactName: "Jane Client", sub: "Jane Client" });
    expect(t.replies[1].contactId).toBeNull();
    expect(t.firm[0]).toMatchObject({ title: "Glanz: rebalancing handed to you", href: "/review-agent" });
  });
  it("falls back to the briefing's own lists until the live ones load, and drops what was marked done", () => {
    const t = buildTiles(sections({ dismissed: ["email:2"] }), null);
    expect(t.texts.map((i) => i.title)).toEqual(["Old Name"]);
    expect(t.replies.map((i) => i.key)).toEqual(["email:1"]);
    expect(t.requests).toEqual([]);
  });
  it("knows what is new: items whose keys were not seen, and nothing before anything has been remembered", () => {
    const items = buildTiles(sections(), live()).texts;
    expect(newKeys(items, null)).toEqual([]);
    expect(newKeys(items, ["quo:msg:1"])).toEqual(["quo:msg:2", "quo:call:3"]);
    expect(newKeys(items, items.map((i) => i.key))).toEqual([]);
  });
});

describe("the buttons and the panel", () => {
  beforeEach(() => localStorage.clear());
  const show = (s = sections(), l: LiveToday | null = live(), onDone = vi.fn()) => { render(<MemoryRouter><TodayTiles sections={s} live={l} onDone={onDone} /></MemoryRouter>); return onDone; };

  it("shows the five buttons with how many are open, and no dots on the first visit", () => {
    show();
    for (const [id, n] of [["texts", "3"], ["replies", "3"], ["ia", "1"], ["firm", "1"], ["requests", "1"]]) expect(screen.getByTestId(`count-${id}`).textContent, id).toBe(n);
    for (const id of ["texts", "replies", "ia", "firm", "requests"]) expect(screen.queryByTestId(`new-${id}`), id).toBeNull();
  });
  it("puts a dot on a button when something new has arrived since it was last opened, and the panel marks which items are new", () => {
    saveSeen("texts", ["quo:msg:1"]);
    saveSeen("replies", ["email:1", "email:2", "email:9"]); saveSeen("ia", ["email:3"]); saveSeen("firm", ["esc:9"]); saveSeen("requests", ["request:r1"]);
    show();
    expect(screen.getByTestId("new-texts").getAttribute("title")).toBe("2 new");
    expect(screen.queryByTestId("new-replies")).toBeNull();
    fireEvent.click(screen.getByTestId("tile-texts"));
    const panel = screen.getByTestId("today-panel");
    const rows = within(panel).getAllByTestId("today-item");
    expect(rows.map((r) => r.getAttribute("data-new"))).toEqual(["false", "true", "true"]);
    // closing it remembers everything shown: the dot goes
    fireEvent.keyDown(panel, { key: "Escape" });
    expect(loadSeen("texts")).toEqual(["quo:msg:1", "quo:msg:2", "quo:call:3"]);
    expect(screen.queryByTestId("new-texts")).toBeNull();
  });
  it("opens the client a text or request is about, and the Inbox page for an unknown number", () => {
    show();
    fireEvent.click(screen.getByTestId("tile-texts"));
    const panel = screen.getByTestId("today-panel");
    expect(within(panel).getByText("Sam Smith").closest("a")?.getAttribute("href")).toBe("/contacts/c1");
    expect(within(panel).getByText("Unknown number").closest("a")?.getAttribute("href")).toBe("/inbox");
    expect(within(panel).getByTestId("open-full-inbox").getAttribute("href")).toBe("/inbox");
  });
  it("opens the email in Gmail and the sender's own page when they are a client", () => {
    show();
    fireEvent.click(screen.getByTestId("tile-replies"));
    const panel = screen.getByTestId("today-panel");
    expect(within(panel).getByText("RRSP question").closest("a")?.getAttribute("href")).toContain("mail.google.com");
    const links = within(panel).getAllByTestId("open-contact");
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute("href")).toBe("/contacts/c4");
    expect(links[0].textContent).toContain("Open Jane Client");
  });
  it("marks an item done, and says so when a list is empty", () => {
    const onDone = show(sections({ ia: [] }), live({ requests: [] }));
    fireEvent.click(screen.getByTestId("tile-texts"));
    fireEvent.click(within(screen.getByTestId("today-panel")).getAllByLabelText("Mark done")[0]);
    expect(onDone).toHaveBeenCalledWith("quo:msg:1");
    fireEvent.keyDown(screen.getByTestId("today-panel"), { key: "Escape" });
    fireEvent.click(screen.getByTestId("tile-requests"));
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
  });
  it("is polled every five minutes and refreshed when texts, calls or requests change", () => {
    const src = readFileSync("src/modules/crm/components/TodayTiles.tsx", "utf8");
    expect(src).toContain("5 * 60 * 1000");
    for (const t of ["quo_messages", "quo_calls", "portal_requests", "portal_request_messages"]) expect(src).toContain(`table: "${t}"`);
  });
});
