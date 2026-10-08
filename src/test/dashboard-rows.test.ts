import { describe, expect, it } from "vitest";
import { dashRow, dashTotals, latestSnapshots } from "../../supabase/functions/_shared/dashboard-rows";

const row = (over: Record<string, unknown>) => dashRow({ id: "a", group: "vineyard", owner: "C", name: "RRIF", ...over } as never);

describe("dashboard rows", () => {
  it("shows change and growth with withdrawals added back", () => {
    const r = row({ boy: 100000, current: 90000, withdrawalsYtd: 20000, accountNumber: "1819071078" });
    expect(r.change).toBe(-10000);
    expect(r.changePct).toBe(-10);
    expect(r.growth).toBe(10000); // 90,000 + 20,000 - 100,000
    expect(r.last4).toBe("1078");
  });
  it("has no change or growth without a BOY, and never treats the gap as growth", () => {
    const r = row({ current: 50000, withdrawalsYtd: 1000 });
    expect([r.boy, r.change, r.growth, r.changePct]).toEqual([null, null, null, null]);
  });
  it("totals change and growth over rows that have a BOY only, and counts the rest", () => {
    const t = dashTotals([row({ boy: 100, current: 110, withdrawalsYtd: 5 }), row({ id: "b", boy: 200, current: 190, withdrawalsYtd: 0 }), row({ id: "c", current: 999 })]);
    expect(t.boy).toBe(300);
    expect(t.change).toBe(0);
    expect(t.growth).toBe(5 - 0 + 0); // (110+5-100) + (190+0-200) = 15 - 10
    expect(t.current).toBe(1299);
    expect(t.withBoy).toBe(2);
    expect(t.withoutBoy).toBe(1);
  });
  it("keeps the newest snapshot per account", () => {
    const m = latestSnapshots([{ id: "x", snapshot_date: "2026-03-31", v: 1 }, { id: "x", snapshot_date: "2026-09-30", v: 2 }, { id: null, snapshot_date: "2026-09-30", v: 3 }] as never[], (r: any) => r.id);
    expect((m.get("x") as any).v).toBe(2);
    expect(m.size).toBe(1);
  });
});
