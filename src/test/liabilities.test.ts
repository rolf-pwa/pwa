import { describe, expect, it } from "vitest";
import { creditAvailable, isRevolving, liabilityTotals, limitOf } from "../modules/crm/lib/liabilities";

describe("household liabilities helpers", () => {
  it("only HELOCs, credit cards and lines of credit are revolving", () => {
    expect(["heloc", "credit_card", "line_of_credit"].every(isRevolving)).toBe(true);
    expect(["mortgage", "personal_loan", "other_debt"].some(isRevolving)).toBe(false);
  });
  it("credit available = limit - balance, never below zero", () => {
    expect(creditAvailable({ liability_type: "heloc", current_balance: 48_000, credit_limit: 100_000 })).toBe(52_000);
    expect(creditAvailable({ liability_type: "credit_card", current_balance: 6_000, credit_limit: 5_000 })).toBe(0);
  });
  it("has no credit available for term debt or when no limit is set", () => {
    expect(creditAvailable({ liability_type: "mortgage", current_balance: 300_000, original_amount: 400_000 })).toBeNull();
    expect(creditAvailable({ liability_type: "credit_card", current_balance: 100, credit_limit: null })).toBeNull();
  });
  it("the limit is the credit limit for revolving credit and the original amount for term debt", () => {
    expect(limitOf({ liability_type: "heloc", current_balance: 1, credit_limit: 100, original_amount: 5 })).toBe(100);
    expect(limitOf({ liability_type: "mortgage", current_balance: 1, credit_limit: 100, original_amount: 400 })).toBe(400);
  });
  it("totals add balances everywhere but limits and availability only for revolving credit", () => {
    const t = liabilityTotals([
      { liability_type: "mortgage", current_balance: 300_000, original_amount: 400_000 },
      { liability_type: "heloc", current_balance: 48_000, credit_limit: 100_000 },
      { liability_type: "credit_card", current_balance: 1_200.5, credit_limit: 10_000 },
      { liability_type: "personal_loan", current_balance: 5_000, original_amount: 10_000 },
    ]);
    expect(t).toEqual({ balance: 354_200.5, revolvingLimit: 110_000, creditAvailable: 60_799.5 });
  });
});
