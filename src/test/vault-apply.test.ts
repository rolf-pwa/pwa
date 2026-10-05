/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from "vitest";
import { applyCorrections, applyPlan, planInsuranceApply, planInvestmentApply } from "../../supabase/functions/_shared/vault-apply";

const members = [
  { id: "c1", first_name: "Adrian", last_name: "Scillato", family_role: "Head of Household" },
  { id: "c2", first_name: "Maria", last_name: "Scillato", family_role: null },
];
const ctx = {
  householdId: "h1", members, sourceFile: "vault:d1:s.pdf",
  vineyard: [{ id: "v1", account_name: "iA - RRSP", account_number: "RR-123" }],
  storehouses: [{ id: "s1", label: "Cash", asset_type: "cash" }],
  holdingTank: [{ id: "t1", account_name: "Old TFSA", account_number: "TF-9" }],
};

describe("planInvestmentApply", () => {
  it("updates a matched vineyard account by number, only with non-null figures", () => {
    const plan = planInvestmentApply([{ account_name: "x", account_number: "rr 123", book_value: 10, current_value: null }], ctx);
    expect(plan).toEqual([{ op: "update", table: "vineyard_accounts", id: "v1", values: { book_value: 10 }, label: "x" }]);
  });
  it("matches storehouses by name and the holding tank before inserting", () => {
    const plan = planInvestmentApply([
      { account_name: "Cash", current_value: 5 },
      { account_name: "zzz", account_number: "TF-9", current_value: 7 },
    ], ctx);
    expect(plan.map((w) => [w.op, w.table])).toEqual([["update", "storehouses"], ["update", "holding_tank"]]);
  });
  it("inserts unmatched accounts into the holding tank for the matching owner, else head of household", () => {
    const [w] = planInvestmentApply([{ account_name: "New", account_number: "N1", account_owner: "MARIA E SCILLATO", custodian: "IA Financial", current_value: 1 }], ctx) as any[];
    expect(w).toMatchObject({ op: "insert", table: "holding_tank", values: { contact_id: "c2", custodian: "iA Financial Group", status: "holding", source_file: "vault:d1:s.pdf" } });
    const [w2] = planInvestmentApply([{ account_name: "Other", current_value: 1 }], ctx) as any[];
    expect(w2.values.contact_id).toBe("c1");
  });
  it("does not insert the same new account twice in one approval", () => {
    const plan = planInvestmentApply([{ account_name: "Dup", account_number: "D1", current_value: 1 }, { account_name: "Dup", account_number: "D1", current_value: 2 }], ctx);
    expect(plan.filter((w) => w.op === "insert")).toHaveLength(1);
    expect(plan.filter((w) => w.op === "update")).toHaveLength(0);
  });
});

describe("planInsuranceApply", () => {
  const ictx = { members, corporations: [{ id: "k1", name: "Scillato Holdings Inc." }], vaultFolderId: "f1", fileName: "p.pdf",
    policies: [{ id: "p1", carrier: "iA", policy_number: "P-1", insured_name: "Adrian Scillato" }] };
  it("updates a matched policy and creates a corporate-owned one", () => {
    const plan = planInsuranceApply([
      { carrier: "iA", policy_number: "P-1", insured_name: "Adrian Scillato", coverage_amount: 500000 },
      { carrier: "SL", policy_number: "P-2", insured_name: "Scillato Holdings Inc.", coverage_amount: 1 },
    ], ictx) as any[];
    expect(plan[0]).toMatchObject({ op: "update", id: "p1", values: { coverage_amount: 500000 } });
    expect(plan[1]).toMatchObject({ op: "insert", values: { contact_id: null, corporation_id: "k1" } });
  });
  it("keeps joint-policy insureds separate (same number, different insured)", () => {
    const plan = planInsuranceApply([
      { carrier: "SL", policy_number: "P-9", insured_name: "Adrian Scillato", coverage_amount: 1 },
      { carrier: "SL", policy_number: "P-9", insured_name: "Maria Scillato", coverage_amount: 1 },
    ], ictx);
    expect(plan.filter((w) => w.op === "insert")).toHaveLength(2);
  });
});

describe("applyCorrections", () => {
  const ex = { accounts: [{ account_number: "A1", current_value: 100, book_value: 90 }] };
  it("records an override per real change and leaves the original untouched", () => {
    const r = applyCorrections("investment", ex, [{ index: 0, field: "current_value", value: 120, notes: " misread " }, { index: 0, field: "book_value", value: 90 }]);
    expect(r.extraction.accounts[0].current_value).toBe(120);
    expect(ex.accounts[0].current_value).toBe(100);
    expect(r.overrides).toEqual([{ field_name: "accounts[0].current_value", original_ai_value: 100, corrected_value: 120, reasoning_notes: "misread" }]);
  });
  it("lets an advisor correct the signed net transactions term (negative = net withdrawals)", () => {
    const r = applyCorrections("investment", ex, [{ index: 0, field: "net_transactions", value: -5541.86 }]);
    expect(r.extraction.accounts[0].net_transactions).toBe(-5541.86);
    expect(r.overrides).toEqual([{ field_name: "accounts[0].net_transactions", original_ai_value: null, corrected_value: -5541.86, reasoning_notes: null }]);
  });
  it("rejects unknown fields, bad indexes and wrong types", () => {
    expect(() => applyCorrections("investment", ex, [{ index: 0, field: "id", value: "x" }])).toThrow(/can't be corrected/);
    expect(() => applyCorrections("investment", ex, [{ index: 5, field: "current_value", value: 1 }])).toThrow(/doesn't exist/);
    expect(() => applyCorrections("investment", ex, [{ index: 0, field: "current_value", value: "12" }])).toThrow(/number/);
    expect(() => applyCorrections("investment", ex, [{ index: 0, field: "account_name", value: 5 }])).toThrow(/text/);
  });
});

describe("applyPlan", () => {
  it("runs every write and reports failures with context", async () => {
    const seen: string[] = [];
    const ok = { from: (t: string) => ({ update: () => ({ eq: async () => { seen.push(`u:${t}`); return { error: null }; } }), insert: async () => { seen.push(`i:${t}`); return { error: null }; } }) };
    const r = await applyPlan(ok, [{ op: "update", table: "vineyard_accounts", id: "v1", values: {}, label: "a" }, { op: "insert", table: "holding_tank", values: {}, label: "b" }]);
    expect(seen).toEqual(["u:vineyard_accounts", "i:holding_tank"]);
    expect(r).toMatchObject({ updated: 1, inserted: 1 });
    const bad = { from: () => ({ insert: async () => ({ error: { message: "nope" } }) }) };
    await expect(applyPlan(bad, [{ op: "insert", table: "holding_tank", values: {}, label: "b" }])).rejects.toThrow(/holding_tank \(b\) failed: nope/);
  });
});
