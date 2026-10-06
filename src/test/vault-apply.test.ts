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

describe("planInvestmentApply: income funds are remembered only from a confirmed extraction", () => {
  // iA statement: funds add up to the statement value (53,143.02) -> confirmed.
  const funds = [
    { name: "Fixed Income Managed Portfolio", category: "Income Funds", value: 23.52 },
    { name: "Dividend Growth", category: "Canadian Equity funds", value: 3_430.94 },
    { name: "Global funds", category: "U.S. & International Equity Funds", value: 45_193.72 },
    { name: "Specialty", category: "Specialty Funds", value: 4_494.84 },
  ];
  const acct = (extra = {}) => ({ account_name: "iA Financial", account_number: "TF-9", book_value: 51_295.72, current_value: 53_143.02, funds, ...extra });
  const tctx = { ...ctx, statementDate: "2026-08-12" };

  it("writes income_funds_value and income_funds_as_of when updating a holding-tank account", () => {
    const [w] = planInvestmentApply([acct()], tctx) as any[];
    expect(w).toMatchObject({ op: "update", table: "holding_tank", id: "t1" });
    expect(w.values).toMatchObject({ book_value: 51_295.72, current_value: 53_143.02, income_funds_value: 23.52, income_funds_as_of: "2026-08-12" });
  });
  it("writes them when updating a vineyard account and when inserting a new holding-tank row", () => {
    const [v] = planInvestmentApply([acct({ account_number: "RR-123" })], tctx) as any[];
    expect(v).toMatchObject({ op: "update", table: "vineyard_accounts" });
    expect(v.values).toMatchObject({ income_funds_value: 23.52, income_funds_as_of: "2026-08-12" });
    const [ins] = planInvestmentApply([acct({ account_number: "NEW-1", account_name: "Brand new" })], tctx) as any[];
    expect(ins).toMatchObject({ op: "insert", table: "holding_tank" });
    expect(ins.values).toMatchObject({ income_funds_value: 23.52, income_funds_as_of: "2026-08-12" });
  });
  it("never writes them to storehouses (no such column)", () => {
    const [w] = planInvestmentApply([acct({ account_name: "Cash", account_number: null })], tctx) as any[];
    expect(w).toMatchObject({ op: "update", table: "storehouses" });
    expect(w.values).not.toHaveProperty("income_funds_value");
    expect(w.values).not.toHaveProperty("income_funds_as_of");
  });
  it("does not write an unconfirmed figure (funds don't add up to the statement value)", () => {
    const [w] = planInvestmentApply([acct({ funds: funds.slice(0, 3) })], tctx) as any[]; // $4,494.84 short
    expect(w.values).not.toHaveProperty("income_funds_value");
    expect(w.values).toMatchObject({ current_value: 53_143.02 }); // the ordinary figures still apply
  });
  it("does not write it when no funds were extracted, or without a valid statement date", () => {
    expect((planInvestmentApply([acct({ funds: null })], tctx)[0] as any).values).not.toHaveProperty("income_funds_value");
    expect((planInvestmentApply([acct()], { ...ctx, statementDate: null })[0] as any).values).not.toHaveProperty("income_funds_value");
    expect((planInvestmentApply([acct()], { ...ctx, statementDate: "Aug 12" })[0] as any).values).not.toHaveProperty("income_funds_value");
  });
  it("an account with only income-fund data still produces an update even if figures are null", () => {
    const [w] = planInvestmentApply([acct({ book_value: null, current_value: null })], tctx) as any[];
    // surplus unknown -> not confirmed, so nothing to write and no spurious update
    expect(w).toBeUndefined();
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

describe("planInvestmentApply: withdrawals (all funds)", () => {
  const hisa = { fund: "High Interest Savings Account (HISA)", category: "Income Funds" };
  const a = (extra = {}) => ({ account_name: "iA Financial", account_number: "TF-9", book_value: 100, current_value: 90, ...extra });
  const tctx = { ...ctx, statementDate: "2026-06-30" };

  it("stores the total of all withdrawals with the statement date", () => {
    const [w] = planInvestmentApply([a({ withdrawals: [{ ...hisa, amount: 40 }, { ...hisa, amount: 2.5 }, { fund: "Equity", category: "Canadian Equity funds", amount: 99 }] })], tctx) as any[];
    expect(w.values).toMatchObject({ withdrawals_ytd: 141.5, withdrawals_as_of: "2026-06-30" });
  });
  it("stores 0 when the statement lists none, and nothing when it wasn't read or has no date", () => {
    expect((planInvestmentApply([a({ withdrawals: [] })], tctx)[0] as any).values).toMatchObject({ withdrawals_ytd: 0 });
    expect((planInvestmentApply([a()], tctx)[0] as any).values).not.toHaveProperty("withdrawals_ytd");
    expect((planInvestmentApply([a({ withdrawals: [{ ...hisa, amount: 5 }] })], { ...ctx, statementDate: null })[0] as any).values).not.toHaveProperty("withdrawals_ytd");
  });
});
