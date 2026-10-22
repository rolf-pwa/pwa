import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ILLUSTRATION_KEYS, ILLUSTRATION_PROMPT, draftFromIllustration } from "../../supabase/functions/_shared/illustration-rules";

const f = (key: string, value: string, quote = "") => ({ key, value, quote });
// What the model should return for iA's two layouts (figures from real illustrations; the insured is a made-up name).
const UL = [
  f("carrier", "iA Financial Group", "iA Financial Group"), f("product", "Genesis universal life insurance, level cost", "Genesis 10 - Universal life, Level cost"), f("policy_type", "universal_life", "Universal life insurance"),
  f("insured_name", "ALEX EXAMPLE", "ALEX EXAMPLE - Male Tobacco use: No"), f("coverage_amount", "50,000.00", "$50,000.00 $34.09"), f("premium_minimum", "$65.86", "Total monthly premium $65.86"),
  f("premium_illustrated", "137.00", "Selected premium for the first year of projection $137.00"), f("premium_frequency", "monthly", "Total monthly premium"), f("premium_payment_years", "20", "Duration of premium payment: 20 years"),
  f("underwriting", "Male, non-tobacco, insurance age 27", "Tobacco use: No"), f("riders", "20-year Option, level cost, $31.77 a month", "20-year Option, Level cost"), f("guarantees", "Insurance costs fully guaranteed for the life of the policy", "Insurance costs are fully guaranteed"),
  f("death_benefit_option", "Face amount + fund", "Death Benefit: Face amount + fund"), f("quote_date", "2026-09-30", "Prepared on: September 30, 2026"),
];
const WL = [
  f("carrier", "iA Financial Group", "iA Participating Life Insurance"), f("product", "iA PAR Wealth, 20-year payment", "iA PAR Wealth - 20-year payment"), f("policy_type", "whole_life", "permanent life insurance"),
  f("insured_name", "ALEX EXAMPLE", "ALEX EXAMPLE - Male"), f("coverage_amount", "50000", "$50,000.00 $139.95"), f("premium_minimum", "139.95", "Total monthly premium $139.95"), f("premium_illustrated", "192.95", "First-year total premium and contributions to ADO $192.95"),
  f("premium_frequency", "monthly", "Monthly premium"), f("premium_payment_years", "20", "Duration of premium payment: 20 years"), f("quote_date", "2026-10-22", "Prepared on: October 22, 2026"),
];

describe("reading an illustration into a quote", () => {
  const ul = draftFromIllustration(UL, "Alex Example", "https://drive.google.com/file/d/abc/view");
  const wl = draftFromIllustration(WL, "Alex Example", "https://drive.google.com/file/d/def/view");
  it("takes the minimum premium as the quote's premium and notes the larger illustrated one (universal life)", () => {
    expect(ul.draft).toMatchObject({ policy_type: "universal_life", carrier: "iA Financial Group", coverage_amount: "50000", premium_amount: "65.86", premium_frequency: "monthly", quote_date: "2026-09-30", term_years: "", illustration_url: "https://drive.google.com/file/d/abc/view" });
    expect(ul.draft.notes).toContain("built on a $137 a month premium");
    expect(ul.draft.notes).toContain("Premiums payable for 20 years.");
    expect(ul.draft.notes).toContain("Death benefit option: Face amount + fund.");
    expect(ul.warnings.some((w) => /minimum \$65\.86/.test(w))).toBe(true);
  });
  it("treats additional deposits on a participating whole life as saving, not premium", () => {
    expect(wl.draft).toMatchObject({ policy_type: "whole_life", premium_amount: "139.95", coverage_amount: "50000" });
    expect(wl.draft.notes).toContain("$192.95 a month premium");
    expect(wl.warnings.some((w) => /minimum \$139\.95/.test(w))).toBe(true);
  });
  it("shows the line each field came from", () => {
    expect(ul.sources.premium_amount).toBe("Total monthly premium $65.86");
    expect(ul.sources.coverage_amount).toBe("$50,000.00 $34.09");
    expect(ul.sources.quote_date).toContain("September 30, 2026");
  });
  it("matches the insured to the chosen person regardless of case, and warns when it is someone else", () => {
    expect(ul.warnings.some((w) => /is for/.test(w))).toBe(false);
    const other = draftFromIllustration(UL, "Thomas Wolfe", "u");
    expect(other.warnings.some((w) => w.includes("This illustration is for ALEX EXAMPLE, not Thomas Wolfe"))).toBe(true);
  });
  it("asks about anything it cannot find rather than guessing", () => {
    const r = draftFromIllustration([f("carrier", "iA"), f("product", "x")], "Alex Example", "u");
    expect(r.draft.policy_type).toBe("other");
    expect(r.warnings.join(" ")).toMatch(/what kind of policy/);
    expect(r.warnings.join(" ")).toMatch(/find the premium/);
    expect(r.warnings.join(" ")).toMatch(/find the coverage amount/);
    expect(r.warnings.join(" ")).toMatch(/who the illustration is for/);
  });
  it("ignores unknown keys, repeats and junk, and assumes monthly only with a warning", () => {
    const r = draftFromIllustration([f("favourite", "x"), f("carrier", "A"), f("carrier", "B"), f("premium_minimum", "100"), "junk", null] as any, "Alex Example", "u");
    expect(r.draft.carrier).toBe("A");
    expect(r.draft.premium_frequency).toBe("monthly");
    expect(r.warnings.join(" ")).toMatch(/assumed the premium is monthly/);
    expect(draftFromIllustration("nope", "x", "u").draft.carrier).toBe("");
  });
  it("tells the model the rules that matter", () => {
    for (const k of ILLUSTRATION_KEYS) expect(ILLUSTRATION_PROMPT).toContain(k);
    expect(ILLUSTRATION_PROMPT).toMatch(/never calculate or guess/);
    expect(ILLUSTRATION_PROMPT).toMatch(/additional deposits and savings are NOT part of premium_minimum/);
  });
  it("is wired: the staff action, the upload on the Quoting page, and a size and type check", () => {
    expect(readFileSync("supabase/functions/review-agent-admin/index.ts", "utf8")).toContain("qParse");
    expect(readFileSync("src/modules/insurance/QuotingWorkspace.tsx", "utf8")).toContain("Upload an illustration");
    const svc = readFileSync("supabase/functions/_shared/illustration-service.ts", "utf8");
    expect(svc).toContain("%PDF-");
    expect(svc).toContain("MAX_ILLUSTRATION_BYTES");
  });
});
