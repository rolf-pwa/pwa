import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CONTRACT_KEYS, CONTRACT_PROMPT, DELIVERY_STATEMENT, RESCISSION_DAYS, deliveryLetterMarkdown, draftFromContract } from "../../supabase/functions/_shared/issuance-rules";

const f = (key: string, value: string, quote = "") => ({ key, value, quote });
const READ = [f("carrier", "iA Financial Group", "iA Financial Group"), f("product", "iA Participating Life Insurance Wealth", "iA PAR Wealth"), f("policy_type", "whole_life", "Participating life"), f("policy_number", "ULA-0012345", "Policy number: ULA-0012345"),
  f("insured_name", "ALEX EXAMPLE", "Insured: ALEX EXAMPLE"), f("coverage_amount", "50,000.00", "Face amount $50,000.00"), f("premium_amount", "139.95", "Monthly premium $139.95"), f("premium_frequency", "monthly", "Monthly premium"),
  f("issued_on", "2026-10-28", "Policy date: October 28, 2026"), f("delivered_on", "2026-10-30", "Delivered electronically on October 30, 2026"), f("primary_beneficiary", "Sam Example", "Beneficiary: Sam Example")];

describe("reading an issued contract", () => {
  const r = draftFromContract(READ, "Alex Example");
  it("fills the policy record with the line each field came from", () => {
    expect(r.draft).toMatchObject({ carrier: "iA Financial Group", policy_type: "whole_life", policy_number: "ULA-0012345", coverage_amount: "50000", premium_amount: "139.95", premium_frequency: "monthly", issued_on: "2026-10-28", delivered_on: "2026-10-30", primary_beneficiary: "Sam Example" });
    expect(r.sources.policy_number).toBe("Policy number: ULA-0012345");
    expect(r.warnings).toEqual([]);
  });
  it("warns when it is for someone else, and when key facts are missing", () => {
    expect(draftFromContract(READ, "Thomas Wolfe").warnings.join(" ")).toContain("not Thomas Wolfe");
    const w = draftFromContract([f("carrier", "iA")], "Alex Example").warnings.join(" ");
    for (const t of ["what kind of policy", "policy number", "coverage amount", "date the policy was issued", "who the policy is for"]) expect(w).toContain(t);
  });
  it("tells the model the rules and keys", () => { for (const k of CONTRACT_KEYS) expect(CONTRACT_PROMPT).toContain(k); expect(CONTRACT_PROMPT).toMatch(/never calculate or guess/); });
});

describe("the closing letter", () => {
  const md = deliveryLetterMarkdown({ firstNames: "Alex", carrier: "iA Financial Group", product: "iA PAR Wealth", policy_type: "whole_life", policy_number: "ULA-0012345", coverage_amount: 50000, premium_amount: 139.95, premium_frequency: "monthly", issued_on: "2026-10-28", delivered_on: "2026-10-30", primary_beneficiary: "Sam Example" });
  it("says the policy is issued and delivered electronically, with its details", () => {
    expect(md).toContain("Hi Alex,");
    expect(md).toContain("Your whole life policy has been issued. iA Financial Group delivered it to you electronically on October 30, 2026.");
    expect(md).toContain("iA Financial Group iA PAR Wealth, policy number ULA-0012345, issued October 28, 2026, $50,000 of coverage, premium $139.95 a month, primary beneficiary Sam Example.");
  });
  it("gives the 10-day right of rescission and asks them to check the policy", () => {
    expect(RESCISSION_DAYS).toBe(10);
    expect(md).toContain("Your 10-day right of rescission");
    expect(md).toContain("you have 10 days from the day you received it to cancel it and receive a full refund of the premiums you paid");
    expect(md).toContain("Check that your name, your date of birth, the coverage, the premium and your beneficiaries are all correct");
    expect(DELIVERY_STATEMENT).toContain("10 days from receiving the policy");
  });
  it("copes with what is not known", () => {
    const m = deliveryLetterMarkdown({ firstNames: "A", carrier: "iA", product: "Term", policy_type: "term", policy_number: "1" });
    expect(m).toContain("iA has delivered it to you electronically.");
    expect(m).not.toContain("undefined");
  });
});

describe("wiring", () => {
  it("has a migration with grants and the new document kind", () => {
    const m = readFileSync("supabase/migrations/20261222120000_insurance_issuances.sql", "utf8");
    expect(m).toMatch(/GRANT ALL ON public\.insurance_issuances TO service_role;/);
    expect(m).toContain("'delivery_letter'");
  });
});

import { DOC_ITEMS as CLIENT_ITEMS } from "@/shared/lib/insuranceDocuments";
import { DOC_ITEMS as SERVER_ITEMS, documentTaskTitle } from "../../supabase/functions/_shared/insurance-doc-client";
import { DOC_FILE_NAME, conventionFile } from "../../supabase/functions/_shared/file-naming";
import { statementFor } from "../../supabase/functions/_shared/insurance-doc-rules";
describe("the closing letter as a document", () => {
  it("ticks the proof of delivery, asks the client to confirm, is named by the convention, and is on the Compliance page", () => {
    expect(SERVER_ITEMS.delivery_letter).toEqual(["delivery_confirmation"]);
    expect(CLIENT_ITEMS).toEqual(SERVER_ITEMS);
    expect(statementFor("delivery_letter")).toBe(DELIVERY_STATEMENT);
    expect(documentTaskTitle("delivery_letter", "Your New Policy")).toBe("Review and confirm your New Policy");
    expect(conventionFile("2026-10-30", [{ first_name: "Alex", last_name: "Example" }], DOC_FILE_NAME.delivery_letter)).toBe("26-10-30_Example_A_Policy Delivery.pdf");
    expect(readFileSync("src/modules/insurance/InsuranceHouseholdPages.tsx", "utf8")).toContain("ApplicationDelivery");
    expect(readFileSync("supabase/functions/review-agent-admin/index.ts", "utf8")).toMatch(/iRead[\s\S]*iSave[\s\S]*iSend/);
    const svc = readFileSync("supabase/functions/_shared/insurance-doc-service.ts", "utf8");
    expect(svc).toContain('d.kind === "delivery_letter"');
  });
});
