import { describe, expect, it } from "vitest";
import { CAPABILITY_LABEL, INVESTMENT_CAPABILITIES_LIVE, NEVER_SELF_SERVE, insuranceSelfServe, investmentSelfServe, isModernized } from "../../supabase/functions/_shared/ia-self-serve";

const p = (policy_type: string, issue_date: string | null, hint?: string) => isModernized({ policy_type, issue_date, hint });

describe("is a policy a modernized iA contract", () => {
  it("is never so for Participating, Universal Life or living benefits, by their hint or type", () => {
    expect(p("whole_life", "2026-06-01", "Participating Life")).toMatchObject({ modernized: false });
    expect(p("universal_life", "2026-06-01")).toMatchObject({ modernized: false });
    expect(p("disability", "2026-06-01")).toMatchObject({ modernized: false });
    expect(p("long_term_care", "2026-06-01")).toMatchObject({ modernized: false });
    expect(p("critical_illness", "2026-06-01", "Cancer Guard")).toMatchObject({ modernized: false });
  });
  it("follows the sale dates once the product is named", () => {
    expect(p("term", "2024-04-01", "Access Life").modernized).toBe(true);
    expect(p("term", "2024-03-31", "Access Life").modernized).toBe(false);
    expect(p("critical_illness", "2025-11-24", "Transition").modernized).toBe(true);
    expect(p("critical_illness", "2025-11-23", "Transition").modernized).toBe(false);
  });
  it("is true for Term Life sold since 30 March 2026, and false for Term sold before April 2024", () => {
    expect(p("term", "2026-03-30").modernized).toBe(true);
    expect(p("term", "2026-12-01").modernized).toBe(true);
    expect(p("term", "2024-03-31").modernized).toBe(false);
  });
  it("is unknown when the CRM cannot tell the product, so Georgia hands the request over", () => {
    expect(p("term", "2025-06-01").modernized).toBeNull();
    expect(p("whole_life", "2026-06-01").modernized).toBeNull();
    expect(p("critical_illness", "2026-01-01").modernized).toBeNull();
    expect(p("other", "2026-06-01").modernized).toBeNull();
    expect(p("term", null).modernized).toBeNull();
  });
  it("is false for Whole Life sold before April 2024, and for critical illness sold before Transition existed", () => {
    expect(p("whole_life", "2023-05-01").modernized).toBe(false);
    expect(p("critical_illness", "2025-01-01").modernized).toBe(false);
  });
  it("gives a reason for every answer", () => {
    for (const r of [p("term", "2026-06-01"), p("term", "2025-06-01"), p("universal_life", "2026-06-01"), p("term", null)]) expect(r.why.length).toBeGreaterThan(10);
  });
});

describe("what the client can do alone", () => {
  it("is banking, payment date and contact information for any policy, with the payment method and delay, stop or restart added when modernized", () => {
    expect(insuranceSelfServe(false)).toEqual(["insurance_banking", "insurance_payment_date", "insurance_contact"]);
    expect(insuranceSelfServe(null)).toEqual(["insurance_banking", "insurance_payment_date", "insurance_contact"]);
    expect(insuranceSelfServe(true)).toEqual(["insurance_banking", "insurance_payment_date", "insurance_contact", "insurance_payment_method", "insurance_delay_stop_reinstate"]);
  });
  it("is deposits only on the investment side for now", () => {
    expect(investmentSelfServe()).toEqual(["investment_deposit"]);
    expect(INVESTMENT_CAPABILITIES_LIVE).toEqual(["investment_deposit"]);
  });
  it("never lists a withdrawal, a transfer or a banking change on an investment account, and never a beneficiary change", () => {
    expect(NEVER_SELF_SERVE).toEqual(["withdrawal", "investment_banking_change", "transfer", "investment_instruction"]);
    const labels = Object.values(CAPABILITY_LABEL).join(" ").toLowerCase();
    expect(labels).not.toMatch(/withdraw|transfer|beneficiar/);
    expect(Object.keys(CAPABILITY_LABEL)).not.toContain("investment_banking");
  });
});
