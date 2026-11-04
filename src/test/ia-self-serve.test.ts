import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { CAPABILITY_LABEL, IA_PRODUCTS, IA_PRODUCT_LABEL, INVESTMENT_CAPABILITIES_LIVE, NEVER_SELF_SERVE, insuranceSelfServe, investmentSelfServe, isIaCarrier, isModernized, policySelfServe } from "../../supabase/functions/_shared/ia-self-serve";

const p = (policy_type: string, issue_date: string | null, ia_product?: string | null, carrier?: string | null) => isModernized({ policy_type, issue_date, ia_product, carrier });

describe("the iA product list", () => {
  it("is iA's own list, with a label for each, and matches what the database allows", () => {
    expect(IA_PRODUCTS).toEqual(["access_life", "transition", "term", "whole_life", "participating_life", "universal_life", "accifamily", "acci_7_plus", "disability", "cancer_guard", "other"]);
    for (const k of IA_PRODUCTS) expect(IA_PRODUCT_LABEL[k].length).toBeGreaterThan(3);
    const sql = readFileSync("supabase/migrations/20270113120000_ia_product.sql", "utf8");
    for (const k of IA_PRODUCTS) expect(sql).toContain(`'${k}'`);
  });
  it("is optional in the database and offered in the policy form", () => {
    expect(readFileSync("supabase/migrations/20270113120000_ia_product.sql", "utf8")).toContain("ADD COLUMN IF NOT EXISTS ia_product text");
    expect(readFileSync("src/modules/crm/components/InsurancePanel.tsx", "utf8")).toContain("<Label>iA Product</Label>");
  });
  it("recognizes an iA carrier by the names it goes by", () => {
    for (const c of ["iA Financial Group", "IA Financial", "Industrial Alliance", "industrial-alliance", "iA"]) expect(isIaCarrier(c), c).toBe(true);
    for (const c of ["Manulife", "Sun Life", "Canada Life", "Mia Insurance", "", null]) expect(isIaCarrier(c as string | null), String(c)).toBe(false);
  });
});

describe("is a policy a modernized iA contract", () => {
  it("is never so for Participating, Universal Life or the living-benefits products", () => {
    expect(p("whole_life", "2026-06-01", "participating_life")).toMatchObject({ modernized: false });
    expect(p("whole_life", "2026-06-01", "universal_life")).toMatchObject({ modernized: false });
    expect(p("universal_life", "2026-06-01")).toMatchObject({ modernized: false });
    for (const prod of ["accifamily", "acci_7_plus", "disability", "cancer_guard"]) expect(p("critical_illness", "2026-06-01", prod), prod).toMatchObject({ modernized: false });
    expect(p("disability", "2026-06-01")).toMatchObject({ modernized: false });
    expect(p("long_term_care", "2026-06-01")).toMatchObject({ modernized: false });
  });
  it("follows the sale date once the product is recorded", () => {
    expect(p("term", "2024-04-01", "access_life").modernized).toBe(true);
    expect(p("term", "2024-03-31", "access_life").modernized).toBe(false);
    expect(p("critical_illness", "2025-11-24", "transition").modernized).toBe(true);
    expect(p("critical_illness", "2025-11-23", "transition").modernized).toBe(false);
    expect(p("term", "2026-03-30", "term").modernized).toBe(true);
    expect(p("term", "2026-03-29", "term").modernized).toBe(false);
    expect(p("whole_life", "2026-03-30", "whole_life").modernized).toBe(true);
    expect(p("whole_life", "2026-03-29", "whole_life").modernized).toBe(false);
  });
  it("lets a recorded product settle what the policy type could not", () => {
    expect(p("term", "2025-06-01").modernized).toBeNull();
    expect(p("term", "2025-06-01", "access_life").modernized).toBe(true);
    expect(p("term", "2025-06-01", "term").modernized).toBe(false);
    expect(p("whole_life", "2026-06-01").modernized).toBeNull();
    expect(p("whole_life", "2026-06-01", "whole_life").modernized).toBe(true);
    expect(p("whole_life", "2026-06-01", "participating_life").modernized).toBe(false);
  });
  it("is unknown without a date when the product needs one, and for 'other'", () => {
    expect(p("term", null, "access_life").modernized).toBeNull();
    expect(p("term", null).modernized).toBeNull();
    expect(p("other", "2026-06-01", "other").modernized).toBeNull();
  });
  it("is unknown from the type alone when the CRM cannot tell the product, so Georgia hands the request over", () => {
    expect(p("critical_illness", "2026-01-01").modernized).toBeNull();
    expect(p("other", "2026-06-01").modernized).toBeNull();
  });
  it("is true for Term Life sold since 30 March 2026 and false for Term or Whole Life sold before April 2024, with no product recorded", () => {
    expect(p("term", "2026-03-30").modernized).toBe(true);
    expect(p("term", "2024-03-31").modernized).toBe(false);
    expect(p("whole_life", "2023-05-01").modernized).toBe(false);
    expect(p("critical_illness", "2025-01-01").modernized).toBe(false);
  });
  it("is false for another carrier's policy, whatever it is", () => {
    expect(p("term", "2026-06-01", "term", "Manulife")).toMatchObject({ modernized: false, why: "Not an iA policy" });
    expect(p("term", "2026-06-01", "term", "iA Financial Group").modernized).toBe(true);
    expect(p("term", "2026-06-01", "term", "").modernized).toBe(true);
  });
  it("gives a reason for every answer", () => {
    for (const r of [p("term", "2026-06-01"), p("term", "2025-06-01"), p("universal_life", "2026-06-01"), p("term", null), p("term", "2026-06-01", "access_life")]) expect(r.why.length).toBeGreaterThan(10);
  });
});

describe("what the client can do alone", () => {
  it("is banking, payment date and contact information for any policy, with the payment method and delay, stop or restart added when modernized", () => {
    expect(insuranceSelfServe(false)).toEqual(["insurance_banking", "insurance_payment_date", "insurance_contact"]);
    expect(insuranceSelfServe(null)).toEqual(["insurance_banking", "insurance_payment_date", "insurance_contact"]);
    expect(insuranceSelfServe(true)).toEqual(["insurance_banking", "insurance_payment_date", "insurance_contact", "insurance_payment_method", "insurance_delay_stop_reinstate"]);
  });
  it("is worked out for one policy, and is nothing for another carrier's", () => {
    expect(policySelfServe({ policy_type: "term", issue_date: "2026-06-01", ia_product: "term", carrier: "iA Financial Group" })).toContain("insurance_delay_stop_reinstate");
    expect(policySelfServe({ policy_type: "universal_life", issue_date: "2020-01-01", carrier: "iA Financial Group" })).toEqual(["insurance_banking", "insurance_payment_date", "insurance_contact"]);
    expect(policySelfServe({ policy_type: "term", issue_date: "2026-06-01", ia_product: "term", carrier: "Manulife" })).toEqual([]);
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
