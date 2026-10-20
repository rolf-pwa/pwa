import { describe, it, expect } from "vitest";
import { isStillOpen, applyOpen, sweepPending, type OpenState } from "../../supabase/functions/_shared/briefing-open";

const state = (over: Partial<OpenState> = {}): OpenState => ({
  today: "2026-10-19", tasks: new Map(), requests: new Map(), emails: new Map(), quo: new Map(), escalations: new Map(), imports: new Map(), pendingScans: 0, notes: new Map(), ...over,
});

describe("is a briefing item still open", () => {
  it("drops an overdue task once it is done or moved to a day that is no longer past", () => {
    const k = "task:overdue:t1";
    expect(isStillOpen(k, state({ tasks: new Map([["t1", { status: "open", due: "2026-10-14" }]]) })).open).toBe(true);
    expect(isStillOpen(k, state({ tasks: new Map([["t1", { status: "done", due: "2026-10-14" }]]) })).open).toBe(false);
    expect(isStillOpen(k, state({ tasks: new Map([["t1", { status: "open", due: "2026-10-23" }]]) })).open).toBe(false); // rescheduled
    expect(isStillOpen(k, state()).open).toBe(false); // gone
  });
  it("keeps a due-today task only while it is due today", () => {
    expect(isStillOpen("task:today:t1", state({ tasks: new Map([["t1", { status: "open", due: "2026-10-19" }]]) })).open).toBe(true);
    expect(isStillOpen("task:today:t1", state({ tasks: new Map([["t1", { status: "open", due: "2026-10-21" }]]) })).open).toBe(false);
  });
  it("drops a request that is resolved or already answered", () => {
    expect(isStillOpen("request:r1", state({ requests: new Map([["r1", { status: "open", awaitingStaff: true }]]) })).open).toBe(true);
    expect(isStillOpen("request:r1", state({ requests: new Map([["r1", { status: "open", awaitingStaff: false }]]) })).open).toBe(false);
    expect(isStillOpen("request:r1", state({ requests: new Map([["r1", { status: "resolved", awaitingStaff: true }]]) })).open).toBe(false);
  });
  it("drops an email that was archived or answered, but keeps it when Gmail could not be read", () => {
    expect(isStillOpen("email:m1", state({ emails: new Map([["m1", { inInbox: true, lastFromMe: false }]]) })).open).toBe(true);
    expect(isStillOpen("email:m1", state({ emails: new Map([["m1", { inInbox: false, lastFromMe: false }]]) })).open).toBe(false);
    expect(isStillOpen("email:m1", state({ emails: new Map([["m1", { inInbox: true, lastFromMe: true }]]) })).open).toBe(false);
    expect(isStillOpen("email:m1", state({ emails: null })).open).toBe(true);
  });
  it("tracks a count: the scanned-documents item relabels itself and goes when none are left", () => {
    expect(isStillOpen("scans", state({ pendingScans: 4 }))).toEqual({ open: true, label: "4 scanned documents waiting for approval" });
    expect(isStillOpen("scans", state({ pendingScans: 1 })).label).toBe("1 scanned document waiting for approval");
    expect(isStillOpen("scans", state()).open).toBe(false);
  });
  it("drops what has been read, resolved or taken off, and leaves unkeyed items alone", () => {
    expect(isStillOpen("note:n1", state({ notes: new Map([["n1", { read: true }]]) })).open).toBe(false);
    expect(isStillOpen("quo:msg:q1", state({ quo: new Map([["msg:q1", { read: true }]]) })).open).toBe(false);
    expect(isStillOpen("esc:o1", state({ escalations: new Map([["o1", { status: "open" }]]) })).open).toBe(false);
    expect(isStillOpen("import:i1", state({ imports: new Map([["i1", { status: "committed" }]]) })).open).toBe(false);
    expect(isStillOpen(undefined, state()).open).toBe(true);
  });
  it("splits a list into open and handled", () => {
    const items = [{ key: "task:overdue:t1", label: "A" }, { key: "task:overdue:t2", label: "B" }, { label: "No key" }];
    const r = applyOpen(items, state({ tasks: new Map([["t1", { status: "done", due: "2026-10-14" }], ["t2", { status: "open", due: "2026-10-14" }]]) }));
    expect(r.open.map((i) => i.label)).toEqual(["B", "No key"]);
    expect(r.handled.map((i) => i.label)).toEqual(["A"]);
  });
});

describe("the inbox sweep item", () => {
  it("stays while sorts are left to rate or archive, and clears when they are done", () => {
    expect(isStillOpen("sweep", state({ sweepPending: 3 })).open).toBe(true);
    expect(isStillOpen("sweep", state({ sweepPending: 0 })).open).toBe(false);
  });
  it("stays when the sweep could not be read", () => expect(isStillOpen("sweep", state()).open).toBe(true));
});

describe("sweepPending", () => {
  it("counts unrated sorts and rated-right Would archive still in the Inbox, never Clients or archived mail", () => {
    const row = (bucket: string, feedback: string | null, archived_at: string | null = null) => ({ bucket, feedback, archived_at });
    expect(sweepPending([row("needs_you", null), row("fyi", "right"), row("archivable", "right"), row("archivable", "right", "2026-10-20"), row("client", null), row("fyi", "wrong")])).toBe(2);
  });
});
