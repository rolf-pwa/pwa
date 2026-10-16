import { describe, it, expect } from "vitest";
import { autoApproveDecision } from "../../supabase/functions/_shared/stage2-auto";
import { withoutStaleValue, planInvestmentApply } from "../../supabase/functions/_shared/vault-apply";

const upd = { op: "update", table: "holding_tank", id: "h1", values: { current_value: 1 }, label: "TFSA" } as any;
const ins = { op: "insert", table: "holding_tank", values: {}, label: "New TFSA" } as any;

describe("which verified items are approved automatically", () => {
  it("approves a verified statement that only updates accounts on file", () => {
    expect(autoApproveDecision("investment", "VERIFIED", [], [upd])).toEqual({ ok: true });
    expect(autoApproveDecision("insurance", "VERIFIED", [], [upd])).toEqual({ ok: true });
  });
  it("leaves anything not fully verified for a person, with the reason", () => {
    expect(autoApproveDecision("investment", "CONFLICT", [], [upd])).toMatchObject({ ok: false, reason: expect.stringMatching(/conflict/i) });
    expect(autoApproveDecision("investment", "INCOMPLETE", ["ytd (acct)"], [upd])).toMatchObject({ ok: false, reason: expect.stringContaining("ytd (acct)") });
  });
  it("never auto-approves estate documents", () => {
    expect(autoApproveDecision("estate", "VERIFIED", [], null)).toMatchObject({ ok: false, reason: expect.stringMatching(/estate/i) });
  });
  it("holds an item that would create a new record, or match nothing", () => {
    expect(autoApproveDecision("investment", "VERIFIED", [], [upd, ins])).toMatchObject({ ok: false, reason: expect.stringContaining("New TFSA") });
    expect(autoApproveDecision("investment", "VERIFIED", [], [])).toMatchObject({ ok: false });
  });
});

describe("an older statement does not set an account back", () => {
  it("drops the current value when a newer value date is held, keeps it otherwise", () => {
    const v = { current_value: 100, book_value: 90 };
    expect(withoutStaleValue(v, "holding_tank", "h1", { statementDate: "2026-06-30", valueDates: { "holding_tank:h1": "2026-09-30" } })).toEqual({ book_value: 90 });
    expect(withoutStaleValue(v, "holding_tank", "h1", { statementDate: "2026-09-30", valueDates: { "holding_tank:h1": "2026-09-30" } })).toEqual(v);
    expect(withoutStaleValue(v, "holding_tank", "h2", { statementDate: "2026-06-30", valueDates: { "holding_tank:h1": "2026-09-30" } })).toEqual(v);
    expect(withoutStaleValue(v, "holding_tank", "h1", { statementDate: null, valueDates: {} })).toEqual(v);
  });
  it("applies in the plan for an account in the Holding Tank", () => {
    const ctx = { householdId: "hh", members: [{ id: "c1", first_name: "A", last_name: "B", family_role: "head_of_family" }], vineyard: [], storehouses: [], holdingTank: [{ id: "h1", account_name: "TFSA", account_number: "111", contact_id: "c1" }], sourceFile: null, statementDate: "2026-06-30", valueDates: { "holding_tank:h1": "2026-09-30" } } as any;
    const plan = planInvestmentApply([{ account_name: "TFSA", account_number: "111", current_value: 50_000, book_value: 40_000 }], ctx);
    const update = plan.find((w) => w.op === "update") as any;
    expect(update.values).toEqual({ book_value: 40_000 });
  });
});
