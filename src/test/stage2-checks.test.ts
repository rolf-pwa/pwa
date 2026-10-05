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
  // The real iA statement ("Change in your investments", since the beginning of the year):
  //   Opening balance 51,295.72 + Net transactions (deposits - withdrawals) -5,541.86 + Variation in value +7,389.16 = 53,143.02
  const ia = { account_number: "1819479981", book_value: 51_295.72, current_harvest: 7_389.16, current_value: 53_143.02 };
  // ...and since contract issue (the other column, which also reconciles): 35,089.23 - 1,034.12 + 19,087.91 = 53,143.02
  const iaSinceIssue = { account_number: "1819479981", book_value: 35_089.23, net_transactions: -1_034.12, current_harvest: 19_087.91, current_value: 53_143.02 };

  it("verifies a self-consistent statement with no net transactions (opening + net gain = current)", () => {
    const checks = checkInvestment(good, NOW);
    expect(by(checks, NG)?.status).toBe("pass");
    expect(by(checks, NG)?.reasoning).toMatch(/no net transactions needed/);
    expect(verdictFor(checks).overall_status).toBe("VERIFIED");
  });
  it("reconciles the real iA statement: opening + net transactions + net gain = current", () => {
    const checks = checkInvestment({ statement_date: "2026-09-30", accounts: [{ ...ia, net_transactions: -5_541.86 }] }, NOW);
    const c = by(checks, NG)!;
    expect(c.status).toBe("pass");
    expect(c.reasoning).toMatch(/- \$5,541\.86 net transactions/);
    expect(c.reasoning).toMatch(/matching the statement's current value of \$53,143\.02/);
    expect(verdictFor(checks)).toMatchObject({ overall_status: "VERIFIED", advisor_override_required: false });
  });
  it("also reconciles the statement's second period (since contract issue), so any consistent column works", () => {
    expect(by(checkInvestment({ ...good, accounts: [iaSinceIssue] }, NOW), NG)?.status).toBe("pass");
  });
  it("catches a model that mixes periods (since-issue opening balance with year-to-date terms)", () => {
    const mixed = { ...ia, book_value: 35_089.23, net_transactions: -5_541.86 };
    const checks = checkInvestment({ ...good, accounts: [mixed] }, NOW);
    expect(by(checks, NG)?.status).toBe("fail");
    expect(verdictFor(checks).overall_status).toBe("CONFLICT");
  });
  it("without net transactions extracted it never fails: it notes the net transactions the figures imply (no false conflict)", () => {
    const checks = checkInvestment({ statement_date: "2026-09-30", accounts: [ia] }, NOW);
    const c = by(checks, NG)!;
    expect(c.status).toBe("pass");
    expect(c.reasoning).toMatch(/net transactions were -\$5,541\.86 \(net withdrawals\)/);
    expect(c.reasoning).toMatch(/no net transactions figure was extracted/);
    expect(verdictFor(checks).overall_status).toBe("VERIFIED");
  });
  it("describes implied net deposits when current is above opening + net gain", () => {
    const c = by(checkInvestment({ ...good, accounts: [{ account_number: "D1", book_value: 100_000, current_harvest: 1_000, current_value: 120_000 }] }, NOW), NG)!;
    expect(c.status).toBe("pass");
    expect(c.reasoning).toMatch(/\+\$19,000\.00 \(net deposits\)/);
  });
  it("fails when the extracted terms don't reconcile, showing every figure", () => {
    const checks = checkInvestment({ statement_date: "2026-09-30", accounts: [{ ...ia, net_transactions: -3_000 }] }, NOW);
    const c = by(checks, NG)!;
    expect(c.status).toBe("fail");
    for (const f of [/\$51,295\.72/, /\$3,000/, /\$7,389\.16/, /\$53,143\.02/]) expect(c.reasoning).toMatch(f);
    expect(verdictFor(checks)).toMatchObject({ overall_status: "CONFLICT", advisor_override_required: true });
  });
  it("handles net deposits (positive) and a loss (negative net gain)", () => {
    const deposit = { account_number: "E1", book_value: 100_000, net_transactions: 10_000, current_harvest: -2_000, current_value: 108_000 };
    expect(by(checkInvestment({ ...good, accounts: [deposit] }, NOW), NG)?.status).toBe("pass");
    expect(by(checkInvestment({ ...good, accounts: [{ ...deposit, current_value: 110_000 }] }, NOW), NG)?.status).toBe("fail");
  });
  it("accepts a net gain when no opening balance was extracted", () => {
    const checks = checkInvestment({ ...good, accounts: [{ account_number: "A1", current_harvest: 7_389.16, current_value: 53_143.02 }] }, NOW);
    expect(by(checks, NG)?.status).toBe("pass");
    expect(verdictFor(checks).overall_status).toBe("VERIFIED");
  });
  it("tolerates only rounding ($1 or 0.02%)", () => {
    const base = { ...ia, net_transactions: -5_541.86 };
    expect(by(checkInvestment({ ...good, accounts: [{ ...base, current_value: 53_143.52 }] }, NOW), NG)?.status).toBe("pass");
    expect(by(checkInvestment({ ...good, accounts: [{ ...base, current_value: 53_243.02 }] }, NOW), NG)?.status).toBe("fail");
  });
  it("is INCOMPLETE (not VERIFIED) when a check can't run, e.g. no net gain was extracted", () => {
    const checks = checkInvestment({ ...good, accounts: [{ account_number: "A1", current_value: 5 }] }, NOW);
    expect(by(checks, NG)?.status).toBe("skipped");
    expect(verdictFor(checks).overall_status).toBe("INCOMPLETE");
    expect(verdictFor(checks, ["custodian"]).missing_items).toContain("custodian");
  });
  it("funds_sum_to_value: passes when the listed funds add up to the statement value", () => {
    const funds = [{ name: "Bond", category: "Income Funds", value: 23.52 }, { name: "Eq", category: "Equity", value: 53_119.5 }];
    const checks = checkInvestment({ ...good, accounts: [{ ...ia, net_transactions: -5_541.86, funds }] }, NOW);
    expect(by(checks, "funds_sum_to_value")?.status).toBe("pass");
    expect(verdictFor(checks).overall_status).toBe("VERIFIED");
  });
  it("funds_sum_to_value: an incomplete fund list is a gap (INCOMPLETE), never a conflict", () => {
    const page2Only = [{ name: "Bond", category: "Income Funds", value: 23.52 }, { name: "Eq", category: "Equity", value: 48_624.66 }];
    const checks = checkInvestment({ ...good, accounts: [{ ...ia, net_transactions: -5_541.86, funds: page2Only }] }, NOW);
    const c = by(checks, "funds_sum_to_value")!;
    expect(c.status).toBe("skipped");
    expect(c.reasoning).toMatch(/\$4,494\.84 isn't accounted for/);
    expect(verdictFor(checks).overall_status).toBe("INCOMPLETE");
  });
  it("funds_sum_to_value: no check when the statement lists no funds", () => {
    expect(by(checkInvestment({ ...good, accounts: [{ ...ia, net_transactions: -5_541.86, funds: null }] }, NOW), "funds_sum_to_value")).toBeUndefined();
    expect(by(checkInvestment({ ...good, accounts: [{ ...ia, net_transactions: -5_541.86 }] }, NOW), "funds_sum_to_value")).toBeUndefined();
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
