import { describe, it, expect } from "vitest";
import { packReadiness } from "../../supabase/functions/_shared/pack-readiness";
import type { Pack } from "../../supabase/functions/_shared/portfolio-review";

const pack = (over: Partial<Pack> = {}): Pack => ({ gaps: [], exceptions: [], resets: { rows: [], toReset: 0, totalRoom: 0 }, ...over } as unknown as Pack);
const resetRow = (over: object) => ({ accountId: "a", name: "iA TFSA", number: "1111", owner: "Doreen", status: "reset", lastResetDate: null, ...over });

describe("pack readiness", () => {
  it("is ready when nothing is missing", () => {
    expect(packReadiness(pack())).toEqual({ todo: [], notes: [], ready: true });
  });
  it("carries the pack's own gaps", () => {
    const r = packReadiness(pack({ gaps: ["No Investor Profile on file. Add the target mix to compare against."] }));
    expect(r.ready).toBe(false);
    expect(r.todo).toHaveLength(1);
  });
  it("asks for the last reset date when a reset is possible and none is recorded", () => {
    const r = packReadiness(pack({ resets: { rows: [resetRow({}) as any], toReset: 1, totalRoom: 1 } }));
    expect(r.todo).toEqual(["Record the last reset date for iA TFSA (Doreen)."]);
    expect(packReadiness(pack({ resets: { rows: [resetRow({ lastResetDate: "2025-06-01" }) as any], toReset: 1, totalRoom: 1 } })).ready).toBe(true);
    expect(packReadiness(pack({ resets: { rows: [resetRow({ status: "no_reset_series" }) as any], toReset: 0, totalRoom: 0 } })).ready).toBe(true);
  });
  it("keeps attention exceptions as notes that do not block", () => {
    const r = packReadiness(pack({ exceptions: [{ severity: "attention", text: "Turns 85 this year." }, { severity: "note", text: "minor" }] }));
    expect(r).toEqual({ todo: [], notes: ["Turns 85 this year."], ready: true });
  });
});
