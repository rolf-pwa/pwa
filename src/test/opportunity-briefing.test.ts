import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { BRIEFING_OPPORTUNITY_LIMIT, briefingItems, moreLabel, pickBriefingOpportunities, type OpportunityRow } from "../../supabase/functions/_shared/opportunity-briefing";
import { isStillOpen, applyOpen, type OpenState } from "../../supabase/functions/_shared/briefing-open";
import { acceptOpportunity, taskFor } from "../../supabase/functions/_shared/opportunity-accept";
import { reconcile, type StoredOpportunity } from "../../supabase/functions/_shared/opportunity-reconcile";

const TODAY = "2026-11-09";
const row = (o: Partial<OpportunityRow> & { id: string }): OpportunityRow => ({ household_id: "h1", title: "A finding", confidence: "high", first_seen: "2026-11-09", status: "open", ...o });

describe("which opportunities reach the briefing", () => {
  it("lists only open ones first seen in the last week", () => {
    const { top, total } = pickBriefingOpportunities([
      row({ id: "new" }), row({ id: "old", first_seen: "2026-10-01" }), row({ id: "snoozed", status: "snoozed" }),
      row({ id: "accepted", status: "accepted" }), row({ id: "dismissed", status: "dismissed" }), row({ id: "edge", first_seen: "2026-11-02" }),
    ], TODAY);
    expect(top.map((r) => r.id).sort()).toEqual(["edge", "new"]);
    expect(total).toBe(2);
  });
  it("puts the surest first, then the newest, and caps the list with a count of the rest", () => {
    const rows = [
      row({ id: "low", confidence: "low" }), row({ id: "med", confidence: "medium" }), row({ id: "hi-old", first_seen: "2026-11-05" }),
      row({ id: "hi-new" }), row({ id: "hi-new2", title: "B finding" }),
    ];
    const { top, more } = pickBriefingOpportunities(rows, TODAY);
    expect(top.map((r) => r.id)).toEqual(["hi-new", "hi-new2", "hi-old"]);
    expect(top).toHaveLength(BRIEFING_OPPORTUNITY_LIMIT);
    expect(more).toBe(2);
  });
  it("returns nothing when nothing is new", () => {
    expect(pickBriefingOpportunities([], TODAY)).toEqual({ top: [], more: 0, total: 0 });
  });
  it("builds a line per opportunity from the stored title, linking to its household, and an 'and N more' line", () => {
    const items = briefingItems([{ ...row({ id: "a", household_id: "h9", title: "No Sovereignty Charter on a $400,000 household" }), householdLabel: "Rivers-Hale" }], 4);
    expect(items[0]).toEqual({ key: "opp:a", label: "Book of Business, Rivers-Hale: No Sovereignty Charter on a $400,000 household", link: "/book-of-business?household=h9" });
    expect(items[1]).toEqual({ key: "opp:more", label: moreLabel(4), link: "/book-of-business" });
    expect(briefingItems([], 0)).toEqual([]);
  });
  it("words one more in the singular", () => {
    expect(moreLabel(1)).toContain("1 more new opportunity this week");
    expect(moreLabel(3)).toContain("3 more new opportunities");
  });
});

const state = (o: Partial<OpenState> = {}): OpenState => ({
  today: TODAY, tasks: new Map(), requests: new Map(), emails: null, quo: new Map(), escalations: new Map(), imports: new Map(), pendingScans: 0, notes: new Map(), ...o,
});

describe("an opportunity item drops off once it is dealt with", () => {
  it("stays while the opportunity is open", () => {
    expect(isStillOpen("opp:a", state({ opps: new Map([["a", { status: "open" }]]) })).open).toBe(true);
  });
  it("goes when it is accepted, snoozed, dismissed, converted or resolved, or has vanished", () => {
    for (const status of ["accepted", "snoozed", "dismissed", "converted", "resolved"]) expect(isStillOpen("opp:a", state({ opps: new Map([["a", { status }]]) })).open, status).toBe(false);
    expect(isStillOpen("opp:a", state({ opps: new Map() })).open).toBe(false);
  });
  it("stays when the state is not known, rather than vanishing on a failed check", () => {
    expect(isStillOpen("opp:a", state()).open).toBe(true);
    expect(isStillOpen("opp:more", state()).open).toBe(true);
  });
  it("keeps the 'and N more' line current, and drops it when nothing extra is left", () => {
    expect(isStillOpen("opp:more", state({ oppsNewOpen: 7, oppsListed: 3 }))).toEqual({ open: true, label: moreLabel(4) });
    expect(isStillOpen("opp:more", state({ oppsNewOpen: 3, oppsListed: 3 })).open).toBe(false);
    // One listed item dealt with: it no longer counts as listed, so the extras are measured against the ones still shown.
    expect(isStillOpen("opp:more", state({ oppsNewOpen: 6, oppsListed: 2 })).label).toBe(moreLabel(4));
  });
  it("splits a mixed list into open and handled", () => {
    const r = applyOpen([{ key: "opp:a" }, { key: "opp:b" }], state({ opps: new Map([["a", { status: "open" }], ["b", { status: "accepted" }]]) }));
    expect(r.open.map((i) => i.key)).toEqual(["opp:a"]);
    expect(r.handled.map((i) => i.key)).toEqual(["opp:b"]);
  });
});

describe("the task made by accepting", () => {
  const o = { title: "No Sovereignty Charter on a $400,000 household", confidence: "high", evidence: [{ label: "Grouped AUM", value: "$400,000" }, { label: "Ratified charter", value: "None" }], next_step: "Offer the Charter at the next review." };
  it("carries the finding, the next step and a week's deadline", () => {
    const t = taskFor(o, "Rivers-Hale", new Date("2026-11-09T12:00:00Z"));
    expect(t.title).toBe("Book of Business: Rivers-Hale: No Sovereignty Charter on a $400,000 household");
    expect(t.description).toContain("- Grouped AUM: $400,000");
    expect(t.description).toContain("Suggested next step: Offer the Charter at the next review.");
    expect(t.description).toContain("not a recommendation to the client");
    expect(t.due_date).toBe("2026-11-16");
  });
  it("copes with no next step, and keeps a long title within the limit", () => {
    expect(taskFor({ ...o, next_step: null }, "H").description).not.toContain("Suggested next step");
    expect(taskFor({ ...o, title: "x".repeat(400) }, "H").title.length).toBe(200);
  });
});

// A small stand-in for the database: records inserts, updates and deletes, and answers selects from fixed rows.
function fakeDb(opts: { opp: Record<string, unknown> | null; updated?: { id: string }[]; afterRace?: Record<string, unknown> | null }) {
  const calls: { table: string; op: string; payload?: unknown }[] = [];
  let selects = 0;
  const db = {
    from(table: string) {
      const q: Record<string, unknown> = {};
      let op = "select", payload: unknown;
      const chain = () => q;
      for (const m of ["eq", "in", "is", "order", "limit"]) q[m] = chain;
      q.select = () => q;
      q.insert = (p: unknown) => { op = "insert"; payload = p; calls.push({ table, op, payload }); return q; };
      q.update = (p: unknown) => { op = "update"; payload = p; calls.push({ table, op, payload }); return q; };
      q.delete = () => { op = "delete"; calls.push({ table, op }); return q; };
      q.single = async () => ({ data: { id: "task-1" }, error: null });
      q.maybeSingle = async () => {
        if (table === "opportunities") { selects += 1; return { data: selects === 1 ? opts.opp : opts.afterRace ?? null, error: null }; }
        return { data: { label: "Rivers-Hale", family_id: "f1" }, error: null };
      };
      q.then = (res: (v: unknown) => unknown) => res(op === "update" && table === "opportunities" ? { data: opts.updated ?? [{ id: "o1" }], error: null } : { data: null, error: null });
      return q;
    },
  };
  return { db, calls };
}
const opp = { id: "o1", household_id: "h1", title: "T", confidence: "high", evidence: [], next_step: null, status: "open", task_id: null };

describe("accepting an opportunity", () => {
  it("creates one task for the user and marks the opportunity accepted with the task linked", async () => {
    const { db, calls } = fakeDb({ opp });
    const r = await acceptOpportunity(db, "o1", "u1", "rolf@prosperwise.ca");
    expect(r).toEqual({ ok: true, taskId: "task-1", already: false });
    const task = calls.find((c) => c.table === "pm_tasks" && c.op === "insert")!.payload as Record<string, unknown>;
    expect(task).toMatchObject({ assignee_id: "u1", created_by: "u1", client_visible: false, household_id: "h1", family_id: "f1", status: "open" });
    expect(calls.find((c) => c.table === "opportunities" && c.op === "update")!.payload).toMatchObject({ status: "accepted", task_id: "task-1", decided_by: "rolf@prosperwise.ca" });
  });
  it("makes no second task when one is already linked", async () => {
    const { db, calls } = fakeDb({ opp: { ...opp, task_id: "t9", status: "accepted" } });
    expect(await acceptOpportunity(db, "o1", "u1", null)).toEqual({ ok: true, taskId: "t9", already: true });
    expect(calls.some((c) => c.op === "insert")).toBe(false);
  });
  it("refuses one that is dismissed, converted or resolved, and one that does not exist", async () => {
    for (const status of ["dismissed", "converted", "resolved"]) {
      const { db, calls } = fakeDb({ opp: { ...opp, status } });
      const r = await acceptOpportunity(db, "o1", "u1", null);
      expect(r.ok).toBe(false);
      expect(calls.some((c) => c.op === "insert")).toBe(false);
    }
    expect((await acceptOpportunity(fakeDb({ opp: null }).db, "o1", "u1", null)).ok).toBe(false);
  });
  it("takes its task back when another click got there first, and returns the winner's task", async () => {
    const { db, calls } = fakeDb({ opp, updated: [], afterRace: { task_id: "t7" } });
    expect(await acceptOpportunity(db, "o1", "u1", null)).toEqual({ ok: true, taskId: "t7", already: true });
    expect(calls.some((c) => c.table === "pm_tasks" && c.op === "delete")).toBe(true);
  });
});

describe("accepted opportunities in the weekly run", () => {
  const stored = (status: StoredOpportunity["status"]): StoredOpportunity => ({ id: "r1", household_id: "h1", type: "idle_cash", key: "k", status, snoozed_until: null });
  const finding = { householdId: "h1", type: "idle_cash" as const, key: "k", title: "t", evidence: [], confidence: "high" as const, nextStep: "n", estValue: null };
  it("keeps an accepted one as it is whether or not it still fires", () => {
    expect(reconcile([stored("accepted")], [finding], new Set(["h1"]), TODAY, "1").updates[0].reopen).toBe(false);
    expect(reconcile([stored("accepted")], [], new Set(["h1"]), TODAY, "1").resolves).toEqual([]);
  });
});

describe("wiring", () => {
  const read = (p: string) => readFileSync(p, "utf8");
  it("the migration adds the accepted status and the task link", () => {
    const sql = read("supabase/migrations/20270108120000_opportunity_accept.sql");
    expect(sql).toContain("'accepted'");
    expect(sql).toContain("task_id uuid REFERENCES public.pm_tasks(id)");
  });
  it("the accept function is staff only and uses the caller's own id", () => {
    const src = read("supabase/functions/book-of-business-accept/index.ts");
    expect(src).toContain("@prosperwise.ca");
    expect(src).toContain("who.id");
  });
  it("the briefing builds the opportunity lines itself and keeps them out of the model's facts", () => {
    const src = read("supabase/functions/daily-briefing-generate/index.ts");
    expect(src).toContain("...firm.opportunities");
    const block = src.slice(src.indexOf("function buildFactsBlockAndRefs"), src.indexOf("function buildSections"));
    expect(block).not.toContain("opportunit");
  });
  it("the briefing refresh recognises opportunity items", () => {
    expect(read("supabase/functions/_shared/briefing-refresh.ts")).toContain('keysOf(all, "opp:")');
  });
  it("the page starts accept through the function and opens the household named in the link", () => {
    const src = read("src/modules/crm/pages/BookOfBusiness.tsx");
    expect(src).toContain('"book-of-business-accept"');
    expect(src).toContain('params.get("household")');
  });
});
