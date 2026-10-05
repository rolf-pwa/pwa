import { describe, expect, it } from "vitest";
import {
  EDITABLE_FIELDS,
  boxToPercent, itemIndexForCheck, parseFieldInput, riskLevel, summarizeChecks, type Stage2AuditRow,
} from "../modules/audit/lib/stage2";

const row = {
  extracted_entities: { kind: "investment", source: null, extraction: { accounts: [{ account_number: "A1" }, { account_number: "A2", account_name: "TFSA" }] } },
} as unknown as Stage2AuditRow;

describe("stage2 ui helpers", () => {
  it("converts a 0-1000 box to page percentages", () => {
    expect(boxToPercent([100, 50, 140, 400])).toEqual({ top: 10, left: 5, height: 4, width: 35 });
  });
  it("buckets risk scores", () => {
    expect([0, 24, 25, 49, 50, 74, 75, 100].map((s) => riskLevel(s).label))
      .toEqual(["Low", "Low", "Moderate", "Moderate", "High", "High", "Critical", "Critical"]);
  });
  it("maps a check back to its item, or null for document-level checks", () => {
    expect(itemIndexForCheck(row, { id: "x", status: "fail", subject: "A2", reasoning: "" })).toBe(1);
    expect(itemIndexForCheck(row, { id: "x", status: "fail", subject: "TFSA", reasoning: "" })).toBe(1);
    expect(itemIndexForCheck(row, { id: "x", status: "fail", reasoning: "" })).toBeNull();
    expect(itemIndexForCheck(row, { id: "x", status: "fail", subject: "nope", reasoning: "" })).toBeNull();
  });
  it("counts checks by status", () => {
    expect(summarizeChecks([
      { id: "a", status: "pass", reasoning: "" }, { id: "b", status: "fail", reasoning: "" }, { id: "c", status: "skipped", reasoning: "" }, { id: "d", status: "pass", reasoning: "" },
    ])).toEqual({ pass: 2, fail: 1, skipped: 1 });
  });
  it("parses advisor input", () => {
    expect(parseFieldInput(" $1,234.50 ", true)).toBe(1234.5);
    expect(parseFieldInput("", true)).toBeNull();
    expect(parseFieldInput("abc", true)).toBeUndefined();
    expect(parseFieldInput("  RRSP ", false)).toBe("RRSP");
  });
  it("labels the gain as Net gain and exposes the reconciliation terms for correction", () => {
    const labels = EDITABLE_FIELDS.investment.map((f) => f.label);
    expect(labels).toEqual(expect.arrayContaining(["BOY value", "Net transactions", "Net gain", "Current value"]));
    expect(labels).not.toContain("Gain");
    const keys = EDITABLE_FIELDS.investment.map((f) => f.key);
    expect(keys).toEqual(expect.arrayContaining(["book_value", "net_transactions", "current_harvest"]));
  });
  it("accepts a negative net transactions entry", () => {
    expect(parseFieldInput("-5,541.86", true)).toBe(-5541.86);
  });
});
