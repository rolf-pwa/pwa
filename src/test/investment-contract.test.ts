import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { addBusinessDays, cancelWindow, cleanContract, deliveryLetter } from "../../supabase/functions/_shared/investment-contract-rules";
import { INVESTMENT_DELIVERY_STATEMENT, statementFor } from "../../supabase/functions/_shared/insurance-doc-rules";
import { DOC_ITEMS as SERVER_ITEMS, documentTaskTitle } from "../../supabase/functions/_shared/insurance-doc-client";
import { DOC_ITEMS } from "@/shared/lib/insuranceDocuments";
import { conventionFile, DOC_FILE_NAME } from "../../supabase/functions/_shared/file-naming";

describe("business days", () => {
  it("skip weekends and do not count the day itself", () => {
    expect(addBusinessDays("2026-10-23", 2)).toBe("2026-10-27"); // Fri + 2 business days = Tue
    expect(addBusinessDays("2026-10-26", 2)).toBe("2026-10-28"); // Mon + 2 = Wed
    expect(addBusinessDays("2026-10-24", 1)).toBe("2026-10-26"); // Sat + 1 = Mon
    expect(addBusinessDays("2026-10-23", 0)).toBe("2026-10-23");
    expect(addBusinessDays("2026-10-23", 10)).toBe("2026-11-06");
  });
});

describe("the right-to-cancel window", () => {
  it("is not assumed: it needs the confirmation date and the number of business days", () => {
    expect(cancelWindow({ confirmationReceivedOn: "", cancelBusinessDays: 2 }, "2026-10-26").state).toBe("unset");
    expect(cancelWindow({ confirmationReceivedOn: "2026-10-23", cancelBusinessDays: null }, "2026-10-26").state).toBe("unset");
  });
  it("is open until the end date, with the days left, and closed after", () => {
    expect(cancelWindow({ confirmationReceivedOn: "2026-10-23", cancelBusinessDays: 2 }, "2026-10-26")).toEqual({ state: "open", endsOn: "2026-10-27", daysLeft: 1 });
    expect(cancelWindow({ confirmationReceivedOn: "2026-10-23", cancelBusinessDays: 2 }, "2026-10-27").daysLeft).toBe(0);
    expect(cancelWindow({ confirmationReceivedOn: "2026-10-23", cancelBusinessDays: 2 }, "2026-10-28")).toEqual({ state: "closed", endsOn: "2026-10-27", daysLeft: null });
  });
});

describe("a contract", () => {
  it("keeps only known fields, valid dates, https links and a sensible number of days", () => {
    const c = cleanContract({ contractNumber: " 123 ", amount: "-5", issuedOn: "yesterday", confirmationReceivedOn: "2026-10-23", cancelBusinessDays: "2", applicationUrl: "javascript:alert(1)", contractUrl: "https://drive.google.com/file/d/abc/view", extra: 1 });
    expect(c).toMatchObject({ contractNumber: "123", amount: 0, issuedOn: "", confirmationReceivedOn: "2026-10-23", cancelBusinessDays: 2, applicationUrl: "", contractUrl: "https://drive.google.com/file/d/abc/view" });
    expect(c as any).not.toHaveProperty("extra");
    expect(cleanContract({ cancelBusinessDays: 500 }).cancelBusinessDays).toBeNull();
    expect(cleanContract({ cancelBusinessDays: "" }).cancelBusinessDays).toBeNull();
    expect(cleanContract({ cancelBusinessDays: 0 }).cancelBusinessDays).toBe(0);
  });
});

describe("the delivery letter", () => {
  const c = cleanContract({ contractNumber: "IA-77", accounts: "RRSP and TFSA", amount: 200000, issuedOn: "2026-10-22", fundFactsOn: "2026-10-22", fundFactsNote: "with the contract by email", confirmationReceivedOn: "2026-10-23", cancelBusinessDays: 2 });
  const at = new Date("2026-10-24T20:00:00Z");
  it("states the contract, when the Fund Facts were given, and the cancel period and end date", () => {
    const t = deliveryLetter({ person: "Justin Santos", date: at, c, modelLabel: "Balanced" });
    for (const s of ["For:** Justin Santos", "number IA-77", "$200,000 in your RRSP and TFSA, in the iA Balanced model portfolio", "on October 22, 2026 (with the contract by email)", "within 2 business days", "**October 27, 2026**", "Your right to cancel"]) expect(t).toContain(s);
    expect(t).not.toContain("____");
  });
  it("leaves blanks for what is unknown, so it cannot be sent unfinished", () => {
    const t = deliveryLetter({ person: "X", date: at, c: cleanContract({}), modelLabel: null });
    expect((t.match(/_{3,}/g) ?? []).length).toBe(4);
  });
});

describe("the delivery letter goes through the signing engine as its own kind", () => {
  it("has its own confirmation wording, task title and file name, and covers no insurance checklist item", () => {
    expect(statementFor("investment_delivery_letter")).toBe(INVESTMENT_DELIVERY_STATEMENT);
    expect(INVESTMENT_DELIVERY_STATEMENT).toContain("Fund Facts");
    expect(INVESTMENT_DELIVERY_STATEMENT).not.toMatch(/policy|10 days/i);
    expect(documentTaskTitle("investment_delivery_letter", "Investment Delivery Letter")).toBe("Review and confirm your Investment Delivery Letter");
    expect(conventionFile("2026-10-24", [{ first_name: "Justin", last_name: "Santos" }], DOC_FILE_NAME.investment_delivery_letter)).toBe("26-10-24_Santos_J_Investment Delivery.pdf");
    expect(SERVER_ITEMS.investment_delivery_letter).toEqual([]); expect(DOC_ITEMS.investment_delivery_letter).toEqual([]);
  });
  it("is not listed or buildable in the insurance workspace", () => {
    const svc = readFileSync("supabase/functions/_shared/insurance-doc-service.ts", "utf8");
    expect(svc).toContain('.not("kind", "in", "(investment_reason_why,investment_delivery_letter)")');
    expect(svc).toContain('kind === "investment_reason_why" || kind === "investment_delivery_letter"');
  });
  it("has a table with grants, the kind in the constraint, and the delete guard counting it", () => {
    const m = readFileSync("supabase/migrations/20270102120000_investment_contracts.sql", "utf8");
    expect(m).toContain("GRANT ALL ON public.investment_contracts TO service_role");
    expect(m).toContain("'investment_reason_why', 'investment_delivery_letter'");
    expect(m).toContain("'investment_reports', 'investment_contracts',");
    expect(m).toContain("'investment_recommendations', 'investment_contracts', 'insurance_policies'");
  });
  it("counts a confirmed delivery letter and a linked application on the file, and has its page, route and handler actions", () => {
    const svc = readFileSync("supabase/functions/_shared/investment-service.ts", "utf8");
    expect(svc).toContain('covered.add("contract_delivery")'); expect(svc).toContain('covered.add("application")');
    expect(readFileSync("src/App.tsx", "utf8")).toContain('path="application"');
    expect(readFileSync("src/modules/investments/InvestmentLayout.tsx", "utf8")).toContain('label: "Application and delivery"');
    const h = readFileSync("supabase/functions/review-agent-admin/index.ts", "utf8");
    for (const a of ["invContracts", "invContractSave", "invContractLetter", "invContractSend"]) expect(h).toContain(`"${a}"`);
  });
});
