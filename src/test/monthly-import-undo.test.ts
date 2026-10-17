import { describe, it, expect } from "vitest";
import { undoRun } from "../../supabase/functions/_shared/monthly-import-undo";

/** A stand-in database that records what is done to it. */
function fakeDb(run: any, entries: any[]) {
  const ops: any[] = [];
  const db: any = {
    ops,
    from(table: string) {
      const q: any = {
        _t: table, _op: null as any,
        select: () => q, order: () => q,
        eq(_c: string, v: any) { if (q._op) { q._op.id = v; ops.push(q._op); } return q; },
        maybeSingle: () => Promise.resolve({ data: table === "monthly_import_runs" ? run : null }),
        update(vals: any) { q._op = { table, kind: "update", vals }; return q; },
        delete() { q._op = { table, kind: "delete" }; return q; },
        then(res: any) { return Promise.resolve({ data: table === "monthly_import_undo" ? entries : [] }).then(res); },
      };
      return q;
    },
  };
  return db;
}

describe("undoing a monthly import", () => {
  const entries = [
    { kind: "account", table_name: "vineyard_accounts", row_id: "a1", previous: { current_value: 100, book_value: 90 } },
    { kind: "snapshot_replaced", table_name: "account_harvest_snapshots", row_id: "s1", previous: { id: "s1", current_value: 100, boy_value: 90 } },
    { kind: "snapshot_created", table_name: "account_harvest_snapshots", row_id: "s2", previous: null },
    { kind: "account_created", table_name: "holding_tank", row_id: "h1", previous: null },
  ];
  it("restores balances and replaced snapshots, and removes what the import created", async () => {
    const db = fakeDb({ id: "r1", status: "committed" }, entries);
    const r = await undoRun(db, "r1", "rolf@prosperwa.ca");
    expect(r).toMatchObject({ accounts_restored: 1, snapshots_restored: 1, snapshots_removed: 1, accounts_removed: 1, errors: [] });
    const byTable = (t: string, k: string) => db.ops.filter((o: any) => o.table === t && o.kind === k);
    expect(byTable("vineyard_accounts", "update")[0]).toMatchObject({ id: "a1", vals: { current_value: 100, book_value: 90 } });
    expect(byTable("account_harvest_snapshots", "update")[0]).toMatchObject({ id: "s1", vals: { current_value: 100, boy_value: 90 } }); // not the id column
    expect(byTable("account_harvest_snapshots", "update")[0].vals.id).toBeUndefined();
    expect(byTable("account_harvest_snapshots", "delete")[0].id).toBe("s2");
    expect(byTable("holding_tank", "delete")[0].id).toBe("h1");
    expect(byTable("monthly_import_runs", "update")[0].vals.status).toBe("undone");
  });
  it("refuses an import that is not committed, or does not exist", async () => {
    await expect(undoRun(fakeDb({ id: "r1", status: "undone" }, []), "r1", "x")).rejects.toThrow(/nothing to undo/);
    await expect(undoRun(fakeDb(null, []), "r1", "x")).rejects.toThrow(/not found/);
  });
});
