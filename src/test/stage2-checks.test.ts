import { describe, expect, it } from "vitest";
import { checkInsurance, checkInvestment, verdictFor } from "../../supabase/functions/_shared/stage2-checks";

const NOW = new Date("2026-10-04T00:00:00Z");
const good = {
  statement_date: "2026-09-30",
  accounts: [{ account_number: "A1", book_value: 100_000, current_harvest: 12_500, current_value: 112_500 }],
};
const by = (cs: ReturnType<typeof checkInvestment>, id: string) => cs.find((c) => c.id === id);

describe("checkInvestment", () => {
  it("verifies a self-consistent statement", () => {
    const checks = checkInvestment(good, NOW);
    expect(by(checks, "harvest_arithmetic")?.status).toBe("pass");
    expect(verdictFor(checks).overall_status).toBe("VERIFIED");
  });
  it("flags a gain that doesn't match value - book, with the numbers in the reasoning", () => {
    const checks = checkInvestment({ ...good, accounts: [{ ...good.accounts[0], current_harvest: 20_000 }] }, NOW);
    const c = by(checks, "harvest_arithmetic")!;
    expect(c.status).toBe("fail");
    expect(c.reasoning).toMatch(/112,500/);
    expect(verdictFor(checks)).toMatchObject({ overall_status: "CONFLICT", advisor_override_required: true });
  });
  it("tolerates statement rounding", () => {
    const checks = checkInvestment({ ...good, accounts: [{ ...good.accounts[0], current_harvest: 12_500.4 }] }, NOW);
    expect(by(checks, "harvest_arithmetic")?.status).toBe("pass");
  });
  it("is INCOMPLETE (not VERIFIED) when a check can't run", () => {
    const checks = checkInvestment({ ...good, accounts: [{ account_number: "A1", current_value: 5 }] }, NOW);
    expect(by(checks, "harvest_arithmetic")?.status).toBe("skipped");
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
