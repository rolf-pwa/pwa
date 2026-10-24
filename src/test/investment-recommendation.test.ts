import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cleanRecommendation, defaultReason, reasonWhyLetter, recommendationIssues, type ModelFull } from "../../supabase/functions/_shared/investment-recommendation-rules";
import { cleanProfile } from "../../supabase/functions/_shared/investment-profile-rules";
import { statementFor, SIGN_STATEMENT_LETTER } from "../../supabase/functions/_shared/insurance-doc-rules";
import { DOC_ITEMS as SERVER_ITEMS } from "../../supabase/functions/_shared/insurance-doc-client";
import { DOC_ITEMS } from "@/shared/lib/insuranceDocuments";
import { documentTaskTitle } from "../../supabase/functions/_shared/insurance-doc-client";
import { conventionFile, DOC_FILE_NAME } from "../../supabase/functions/_shared/file-naming";

const BAL: ModelFull = { profile_key: "balanced", label: "Balanced", income_min: 35, income_max: 55, equity_min: 45, equity_max: 65, as_of: "2026-05-31", funds: [{ name: "Fixed income managed portfolio (iA)", weight: 40 }, { name: "Fidelity Insights", weight: 20 }, { name: "Canadian Equity Growth (iA)", weight: 10 }] };
const GRO: ModelFull = { profile_key: "growth", label: "Growth", income_min: 20, income_max: 40, equity_min: 60, equity_max: 80, funds: [{ name: "Fidelity Insights", weight: 30 }] };
const MODELS = [BAL, GRO];
const profile = cleanProfile({ objectives: ["growth", "income"], timeHorizonYears: 15, amountToInvest: 200000, annualIncome: 120000, knowledge: "limited", guaranteeImportance: "high", liquidityNeedsAmount: 20000, liquidityNeedsWhen: "within 3 years", riskProfile: "balanced", riskProfileDate: "2026-10-24" });
const rec = (o: object = {}) => cleanRecommendation({ profileKey: "balanced", amount: 200000, accounts: "RRSP and TFSA", guarantee: "75% at maturity and death", fees: "Low load, 2.4% MER", reason: "It matches your goals.", ...o });

describe("a recommendation", () => {
  it("keeps only what is known", () => {
    const c = cleanRecommendation({ profileKey: "Bal!!", amount: "-5", reason: "x".repeat(5000), evil: 1 });
    expect(c.profileKey).toBe(""); expect(c.amount).toBe(0); expect(c.reason).toHaveLength(2000); expect(c as any).not.toHaveProperty("evil");
  });
  it("needs a model, the amount, a recorded risk profile, and a reason when it is not the model for that profile", () => {
    expect(recommendationIssues(rec(), "balanced", MODELS)).toEqual([]);
    expect(recommendationIssues(rec(), "", MODELS)).toEqual(["Record the risk profile from the iA investor profile first: the portfolio follows it."]);
    expect(recommendationIssues(rec({ amount: 0 }), "balanced", MODELS)).toEqual(["Enter the amount to invest."]);
    expect(recommendationIssues(rec({ profileKey: "" }), "balanced", MODELS)).toContain("Choose the model portfolio.");
    expect(recommendationIssues(rec({ profileKey: "growth" }), "balanced", MODELS)).toEqual(["This is not the model for the client's risk profile. Say why."]);
    expect(recommendationIssues(rec({ profileKey: "growth", deviationReason: "Longer horizon than the profile assumed." }), "balanced", MODELS)).toEqual([]);
    expect(recommendationIssues(rec({ profileKey: "other" }), "balanced", MODELS)).toContain("That is not one of iA's model portfolios.");
  });
  it("starts the reasons from the profile and the model", () => {
    const t = defaultReason(profile, BAL);
    for (const s of ["grow capital and generate income", "about 15 years", "Balanced risk profile", "35% to 55% in fixed income and 45% to 65% in equity", "limited", "$20,000 within 3 years"]) expect(t).toContain(s);
  });
});

describe("the reason why letter", () => {
  const letter = (r = rec(), model = BAL, dflt: ModelFull | null = BAL) => reasonWhyLetter({ person: "Justin Santos", date: new Date("2026-10-24T20:00:00Z"), profile, model, defaultModel: dflt, rec: r });
  it("states the recommendation, why, the funds, the guarantee and fees, and the cancellation pointer", () => {
    const t = letter();
    for (const s of ["For:** Justin Santos", "investing $200,000 in the iA Balanced model portfolio", "held in your RRSP and TFSA", "It matches your goals.", "- Fixed income managed portfolio (iA): 40%", "**Guarantee:** 75% at maturity and death", "**Fees:** Low load, 2.4% MER", "Fund Facts", "Your right to cancel", "as at 2026-05-31"]) expect(t).toContain(s);
    expect(t.indexOf("Fixed income managed")).toBeLessThan(t.indexOf("Canadian Equity Growth")); // largest holding first
    expect(t).not.toContain("____");
  });
  it("leaves blanks for what is unknown, so it cannot be sent unfinished", () => {
    const t = letter(rec({ guarantee: "", fees: "", reason: "" }));
    expect((t.match(/_{3,}/g) ?? []).length).toBe(3);
  });
  it("says so when the portfolio is not the one for the risk profile", () => {
    const t = letter(rec({ profileKey: "growth", deviationReason: "You have a longer horizon." }), GRO, BAL);
    expect(t).toContain("A note on the risk profile");
    expect(t).toContain("gave a Balanced risk profile");
    expect(t).toContain("You have a longer horizon.");
    expect(letter()).not.toContain("A note on the risk profile");
  });
});

describe("the letter goes through the signing engine as its own kind", () => {
  it("is a confirmation letter, titled and filed apart from the insurance reason why", () => {
    expect(statementFor("investment_reason_why")).toBe(SIGN_STATEMENT_LETTER);
    expect(documentTaskTitle("investment_reason_why", "Investment Reason Why Letter")).toBe("Review and confirm your Investment Reason Why Letter");
    expect(conventionFile("2026-10-24", [{ first_name: "Justin", last_name: "Santos" }], DOC_FILE_NAME.investment_reason_why)).toBe("26-10-24_Santos_J_Investment Reason Why.pdf");
    expect(SERVER_ITEMS.investment_reason_why).toEqual([]);
    expect(DOC_ITEMS.investment_reason_why).toEqual([]);
  });
  it("is not listed in the insurance workspace, and cannot be built there", () => {
    const svc = readFileSync("supabase/functions/_shared/insurance-doc-service.ts", "utf8");
    expect(svc).toContain('.neq("kind", "investment_reason_why")');
    expect(svc).toContain('if (kind === "investment_reason_why") return { error:');
  });
  it("has a table with grants, the kind in the constraint, and the delete guard counting it", () => {
    const m = readFileSync("supabase/migrations/20261231120000_investment_recommendations.sql", "utf8");
    expect(m).toContain("GRANT ALL ON public.investment_recommendations TO service_role");
    expect(m).toContain("'delivery_letter', 'investment_reason_why'");
    expect(m).toContain("'investment_files', 'investment_profiles', 'investment_recommendations',");
    expect(m).toContain("recs := ARRAY['investment_profiles', 'investment_recommendations', 'insurance_policies'");
  });
  it("counts a confirmed letter as the Reason why item, and has its page, route, and handler actions", () => {
    expect(readFileSync("supabase/functions/_shared/investment-service.ts", "utf8")).toContain('covered.add("reason_why")');
    expect(readFileSync("src/App.tsx", "utf8")).toContain('path="recommendation"');
    expect(readFileSync("src/modules/investments/InvestmentLayout.tsx", "utf8")).toContain('label: "Recommendation"');
    const h = readFileSync("supabase/functions/review-agent-admin/index.ts", "utf8");
    for (const a of ["invRecs", "invRecSave", "invRecLetter", "invRecSend"]) expect(h).toContain(`"${a}"`);
  });
});
