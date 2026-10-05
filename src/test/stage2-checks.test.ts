import { describe, expect, it } from "vitest";
import { checkInsurance, checkInvestment, verdictFor } from "../../supabase/functions/_shared/stage2-checks";

const NOW = new Date("2026-10-04T00:00:00Z");
const good = {
  statement_date: "2026-09-30",
  accounts: [{ account_number: "A1", book_value: 100_000, current_harvest: 12_500, current_value: 112_500 }],
};
const by = (cs: ReturnType<typeof checkInvestment>, id: string) => cs.find((c) => c.id === id);

describe("checkInvestment", () => {
  const NG = "net_gain_reconciliation";
  // The real iA statement from the first production scan: BOY 51,295.72 - withdrawals 5,541.86 + net gain 7,389.16 = 53,143.02.
  const ia = { account_number: "1819479981", book_value: 51_295.72, current_harvest: 7_389.16, current_value: 53_143.02 };

  it("verifies a self-consistent statement with no withdrawals (BOY + net gain = current)", () => {
    const checks = checkInvestment(good, NOW);
    expect(by(checks, NG)?.status).toBe("pass");
    expect(by(checks, NG)?.reasoning).toMatch(/no withdrawals needed/);
    expect(verdictFor(checks).overall_status).toBe("VERIFIED");
  });
  it("reconciles BOY - withdrawals + net gain = current when the withdrawals are extracted (the real iA statement)", () => {
    const checks = checkInvestment({ statement_date: "2026-09-30", accounts: [{ ...ia, withdrawals: 5_541.86 }] }, NOW);
    expect(by(checks, NG)?.status).toBe("pass");
    expect(by(checks, NG)?.reasoning).toMatch(/withdrawals \$5,541\.86/);
    expect(verdictFor(checks)).toMatchObject({ overall_status: "VERIFIED", advisor_override_required: false });
  });
  it("without withdrawals extracted it never fails: it notes the withdrawals the figures imply (no false conflict)", () => {
    const checks = checkInvestment({ statement_date: "2026-09-30", accounts: [ia] }, NOW);
    const c = by(checks, NG)!;
    expect(c.status).toBe("pass");
    expect(c.reasoning).toMatch(/withdrawals of \$5,541\.86/);
    expect(c.reasoning).toMatch(/no withdrawals were extracted/);
    expect(verdictFor(checks).overall_status).toBe("VERIFIED");
  });
  it("fails when the extracted terms don't reconcile, showing every figure", () => {
    const checks = checkInvestment({ statement_date: "2026-09-30", accounts: [{ ...ia, withdrawals: 3_000 }] }, NOW);
    const c = by(checks, NG)!;
    expect(c.status).toBe("fail");
    expect(c.reasoning).toMatch(/\$51,295\.72/); expect(c.reasoning).toMatch(/withdrawals \$3,000/); expect(c.reasoning).toMatch(/net gain \$7,389\.16/); expect(c.reasoning).toMatch(/\$53,143\.02/);
    expect(verdictFor(checks)).toMatchObject({ overall_status: "CONFLICT", advisor_override_required: true });
  });
  it("includes contributions when the statement shows them", () => {
    const ok = { account_number: "C1", book_value: 100_000, contributions: 10_000, withdrawals: 2_000, current_harvest: 5_000, current_value: 113_000 };
    expect(by(checkInvestment({ ...good, accounts: [ok] }, NOW), NG)?.status).toBe("pass");
    expect(by(checkInvestment({ ...good, accounts: [{ ...ok, current_value: 120_000 }] }, NOW), NG)?.status).toBe("fail");
  });
  it("notes (without failing) a current value above BOY + net gain when no contributions were extracted", () => {
    const c = by(checkInvestment({ ...good, accounts: [{ account_number: "D1", book_value: 100_000, current_harvest: 1_000, current_value: 120_000 }] }, NOW), NG)!;
    expect(c.status).toBe("pass");
    expect(c.reasoning).toMatch(/contributions or transfers in/);
  });
  it("accepts a net gain when no BOY value was extracted", () => {
    const checks = checkInvestment({ ...good, accounts: [{ account_number: "A1", current_harvest: 7_389.16, current_value: 53_143.02 }] }, NOW);
    expect(by(checks, NG)?.status).toBe("pass");
    expect(verdictFor(checks).overall_status).toBe("VERIFIED");
  });
  it("tolerates only rounding ($1 or 0.02%)", () => {
    const base = { ...ia, withdrawals: 5_541.86 };
    expect(by(checkInvestment({ ...good, accounts: [{ ...base, current_value: 53_143.52 }] }, NOW), NG)?.status).toBe("pass");
    expect(by(checkInvestment({ ...good, accounts: [{ ...base, current_value: 53_243.02 }] }, NOW), NG)?.status).toBe("fail");
  });
  it("is INCOMPLETE (not VERIFIED) when a check can't run, e.g. no net gain was extracted", () => {
    const checks = checkInvestment({ ...good, accounts: [{ account_number: "A1", current_value: 5 }] }, NOW);
    expect(by(checks, NG)?.status).toBe("skipped");
    expect(verdictFor(checks).overall_status).toBe("INCOMPLETE");
    expect(verdictFor(checks, ["custodian"]).missing_items).toContain("custodian");
  });
  it("fails future, stale and invalid statement dates", () => {
    expect(by(checkInvestment({ ...good, statement_date: "2026-12-01" }, NOW), "statement_date_plausible")?.status).toBe("fail");
    expect(by(checkInvestment({ ...good, statement_date: "2024-01-01" }, NOW), "statement_date_plausible")?.status).toBe("fail");
    expect(by(checkInvestment({ ...good, statement_date: "2026-13-45" }, NOW), "statement_date_plausible")?.status).toBe("fail");
  });
  it("fails negative values, missing values, empty extractions and duplicate account numbers", () => {
    expect(by(checkInvestment({ ...good, accounts: [{ account_number: "A1", current_value: -5 }] }, NOW), "value_non_negative")?.status).toBe("fail");
    expect(by(checkInvestment({ ...good, accounts: [{ account_number: "A1" }] }, NOW), "value_present")?.status).toBe("fail");
    expect(by(checkInvestment({ statement_date: "2026-09-30", accounts: [] }, NOW), "accounts_present")?.status).toBe("fail");
    const dup = { ...good, accounts: [good.accounts[0], good.accounts[0]] };
    expect(by(checkInvestment(dup, NOW), "duplicate_account_number")?.status).toBe("fail");
  });
});

describe("checkInsurance", () => {
  it("passes a sane policy and fails renewal before issue", () => {
    const ok = checkInsurance({ policies: [{ policy_number: "P1", coverage_amount: 500_000, issue_date: "2020-01-01", renewal_date: "2030-01-01" }] });
    expect(ok.every((c) => c.status === "pass")).toBe(true);
    const bad = checkInsurance({ policies: [{ policy_number: "P1", coverage_amount: 500_000, issue_date: "2020-01-01", renewal_date: "2019-01-01" }] });
    expect(bad.find((c) => c.id === "renewal_after_issue")?.status).toBe("fail");
  });
});
