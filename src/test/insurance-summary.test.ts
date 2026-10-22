import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { annualPremium, categoryOf, summarize, totalsFor, type SummaryPolicy } from "../shared/lib/insuranceSummary";

const pol = (o: Partial<SummaryPolicy> & { id: string }): SummaryPolicy => ({ contact_id: "a", policy_number: null, policy_type: "term", coverage_amount: 0, ...o }) as SummaryPolicy;

describe("coverage categories and premiums", () => {
  it("groups the policy types into life, critical illness, disability, long-term care and other", () => {
    expect(["term", "whole_life", "universal_life"].map(categoryOf)).toEqual(["life", "life", "life"]);
    expect(categoryOf("critical_illness")).toBe("critical_illness");
    expect(categoryOf("disability")).toBe("disability");
    expect(categoryOf("long_term_care")).toBe("long_term_care");
    expect(categoryOf("other")).toBe("other");
    expect(categoryOf(null)).toBe("other");
  });
  it("turns a premium into a year's cost, and counts a single premium or no frequency as nothing a year", () => {
    expect(annualPremium({ premium_amount: 100, premium_frequency: "monthly" })).toBe(1200);
    expect(annualPremium({ premium_amount: 300, premium_frequency: "quarterly" })).toBe(1200);
    expect(annualPremium({ premium_amount: 600, premium_frequency: "semi_annual" })).toBe(1200);
    expect(annualPremium({ premium_amount: 1200, premium_frequency: "annual" })).toBe(1200);
    expect(annualPremium({ premium_amount: 50000, premium_frequency: "single" })).toBe(0);
    expect(annualPremium({ premium_amount: 100, premium_frequency: null })).toBe(0);
  });
});

describe("summarizing a household's coverage", () => {
  const people = [{ id: "a", name: "Colleen" }, { id: "b", name: "Rick" }];
  const rows: SummaryPolicy[] = [
    pol({ id: "1", contact_id: "a", policy_number: "P1", policy_type: "universal_life", coverage_amount: 500_000, premium_amount: 200, premium_frequency: "monthly", cash_value: 12_000 }),
    pol({ id: "2", contact_id: "a", policy_number: "P1", policy_type: "term", coverage_amount: 250_000 }), // a rider on the same policy
    pol({ id: "3", contact_id: "a", policy_type: "critical_illness", coverage_amount: 100_000, premium_amount: 80, premium_frequency: "monthly", renewal_date: "2026-11-15" }),
    pol({ id: "4", contact_id: null, corporation_id: "c1", policy_type: "term", coverage_amount: 1_000_000 } as any),
  ];
  it("adds each coverage by type, counts a policy and its riders once, and totals premiums and cash value", () => {
    const t = totalsFor(rows.slice(0, 3));
    expect(t.coverage.life).toBe(750_000);
    expect(t.coverage.critical_illness).toBe(100_000);
    expect(t.policies).toBe(2); // the universal life with its rider, and the critical illness
    expect(t.premiumsPerYear).toBe(200 * 12 + 80 * 12);
    expect(t.cashValue).toBe(12_000);
  });
  it("shows each person, flags someone with no life coverage, and keeps corporation-owned cover apart", () => {
    const s = summarize(rows, people, "2026-10-22");
    expect(s.byPerson.map((p) => [p.name, p.hasLife])).toEqual([["Colleen", true], ["Rick", false]]);
    expect(s.others?.coverage.life).toBe(1_000_000);
    expect(s.overall.coverage.life).toBe(1_750_000);
  });
  it("lists renewals in the next 90 days, soonest first, and not past or distant ones", () => {
    const extra = [...rows, pol({ id: "5", contact_id: "b", renewal_date: "2026-10-01" }), pol({ id: "6", contact_id: "b", renewal_date: "2027-06-01" }), pol({ id: "7", contact_id: "b", renewal_date: "2026-10-25" })];
    const s = summarize(extra, people, "2026-10-22");
    expect(s.renewals.map((r) => [r.policy.id, r.days])).toEqual([["7", 3], ["3", 24]]);
  });
});

describe("where the Insurance tab lives", () => {
  it("is a tab on both the household and the contact page, and the files card is no longer in the Vault tab", () => {
    const hh = readFileSync("src/modules/crm/pages/HouseholdDetail.tsx", "utf8");
    const ct = readFileSync("src/modules/crm/pages/ContactDetail.tsx", "utf8");
    expect(hh).toContain('<TabsTrigger value="insurance"');
    expect(hh).toContain("<InsuranceTab householdId={id!} />");
    expect(hh).not.toContain("<InsuranceFiles");
    expect(ct).toContain('<TabsTrigger value="insurance"');
    expect(ct).toContain("<InsuranceTab householdId={contact.household_id ?? null} contactId={id!} />");
    expect(ct).not.toContain("<InsurancePanel");
    expect(readFileSync("src/modules/crm/components/InsuranceTab.tsx", "utf8")).toContain("<InsuranceFiles householdId={householdId} />");
  });
});
