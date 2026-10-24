import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { investmentReportBlocks, type InvestmentReportInput, type ReportPerson } from "../../supabase/functions/_shared/investment-report-rules";
import { cleanProfile } from "../../supabase/functions/_shared/investment-profile-rules";
import type { ModelFull } from "../../supabase/functions/_shared/investment-recommendation-rules";
import { buildBrandedPdf } from "../../supabase/functions/_shared/simple-pdf";
import { conventionFile, DOC_FILE_NAME } from "../../supabase/functions/_shared/file-naming";

const BAL: ModelFull = { profile_key: "balanced", label: "Balanced", income_min: 35, income_max: 55, equity_min: 45, equity_max: 65, as_of: "2026-05-31", funds: [{ name: "Fidelity Insights", weight: 20 }, { name: "Fixed income managed portfolio (iA)", weight: 40 }] };
const GRO: ModelFull = { profile_key: "growth", label: "Growth", income_min: 20, income_max: 40, equity_min: 60, equity_max: 80, funds: [{ name: "Fidelity Insights", weight: 30 }] };
const profile = cleanProfile({ objectives: ["growth"], timeHorizonYears: 15, annualIncome: 120000, incomeStability: "stable", currentInvestments: 300000, knowledge: "good", guaranteeImportance: "high", riskProfile: "balanced", riskProfileDate: "2026-10-24" });
const rec = (o: object = {}) => ({ profileKey: "balanced", amount: 200000, accounts: "RRSP", guarantee: "75% maturity and death", fees: "Low load, 2.4% MER", reason: "It matches your goals.", deviationReason: "", ...o });
const justin: ReportPerson = { name: "Justin Santos", profile, profileSavedAt: "2026-10-24T18:00:00Z", rec: rec() };
const lisa: ReportPerson = { name: "Lisa Santos", profile: null, profileSavedAt: null, rec: null };
const base = (o: Partial<InvestmentReportInput> = {}): InvestmentReportInput => ({ preparedOn: "October 24, 2026", coverNote: null, includeFunds: true, models: [BAL, GRO], people: [justin, lisa], ...o });
const text = (i: InvestmentReportInput) => JSON.stringify(investmentReportBlocks(i));

describe("the investment recommendation report", () => {
  it("opens with who it is for, and the note when there is one", () => {
    expect(text(base())).toContain("Prepared for Justin Santos and Lisa Santos by Rolf Issler");
    expect(text(base())).not.toContain("A note from Rolf");
    expect(text(base({ coverNote: "Thank you for Tuesday." }))).toContain("A note from Rolf");
  });
  it("shows where each person stands from the saved profile, and says so when there is none", () => {
    const t = text(base());
    for (const s of ["What you want: Grow capital", "Time horizon: 15 years", "Income: $120,000 a year (stable)", "Investments held today: $300,000", "Investment knowledge: Good", "Importance of guarantees: Very important", "Risk profile from the investor profile you completed with iA: Balanced"]) expect(t).toContain(s);
    expect(t).toContain("Lisa Santos: no investor profile has been saved yet.");
  });
  it("recommends the iA model portfolio with the amount, guarantee, fees and reasons, and lists its funds largest first", () => {
    const t = text(base());
    for (const s of ["Justin Santos: iA Balanced model portfolio", "Mix: 35% to 55% fixed income, 45% to 65% equity", "Amount to invest: $200,000", "Accounts: RRSP", "Guarantee: 75% maturity and death", "Fees: Low load, 2.4% MER", "Why we recommend it: It matches your goals."]) expect(t).toContain(s);
    expect(t.indexOf("Fixed income managed portfolio (iA): 40%")).toBeLessThan(t.indexOf("Fidelity Insights: 20%"));
    expect(text(base({ includeFunds: false }))).not.toContain("What the Balanced portfolio holds");
  });
  it("explains a portfolio that is not the one for the risk profile", () => {
    const t = text(base({ people: [{ ...justin, rec: rec({ profileKey: "growth", deviationReason: "You have a longer horizon." }) }] }));
    expect(t).toContain("Why not the Balanced portfolio for your risk profile: You have a longer horizon.");
    expect(text(base())).not.toContain("Why not the");
  });
  it("says when nothing has been recommended, and always ends with what to be aware of and what happens next", () => {
    const t = text(base({ people: [{ ...justin, rec: null }] }));
    expect(t).toContain("Justin Santos: we have not yet made a recommendation.");
    for (const s of ["What to be aware of", "Fund Facts", "What happens next", "the investor profile that sets your risk profile"]) expect(t).toContain(s);
    expect(text(base({ people: [lisa] }))).toContain("No recommendations have been made yet.");
  });
  it("builds a PDF and is filed under the naming convention", () => {
    const pdf = buildBrandedPdf({ title: "Investment Recommendation Report", subtitle: "x", footer: "ProsperWise Advisors", blocks: investmentReportBlocks(base()) });
    expect(new TextDecoder("latin1").decode(pdf.subarray(0, 5))).toBe("%PDF-");
    expect(conventionFile("2026-10-24", [{ first_name: "Justin", last_name: "Santos" }], DOC_FILE_NAME.investment_report)).toBe("26-10-24_Santos_J_Investment Recommendation Report.pdf");
  });
});

describe("sharing it in the portal", () => {
  const sharing = readFileSync("supabase/functions/_shared/report-sharing.ts", "utf8");
  it("serves both kinds of report from one place, to the people they were prepared for, while shared", () => {
    expect(sharing).toContain('const TABLES: ReportTable[] = ["insurance_reports", "investment_reports"]');
    expect(sharing).toContain('.not("shared_at", "is", null).contains("contact_ids", [contactId])');
    expect(sharing).toContain("if (!r.shared_at || !((r.contact_ids ?? []) as string[]).includes(contactId)) return { error: \"Not available\" }");
    expect(sharing).toContain("if (notify && !r.shared_at)");
    expect(readFileSync("supabase/functions/portal-pm-tasks/index.ts", "utf8")).toContain('from "../_shared/report-sharing.ts"');
  });
  it("keeps the insurance planning report's sharing working through the same code", () => {
    const planning = readFileSync("supabase/functions/_shared/planning-report-service.ts", "utf8");
    expect(planning).toContain('shareReportIn(db, "insurance_reports"');
    expect(planning).toContain('unshareReportIn(db, "insurance_reports"');
  });
  it("has a table with grants, handler actions, a page, a route and a menu item, and the delete guard counts it", () => {
    const m = readFileSync("supabase/migrations/20270101120000_investment_reports.sql", "utf8");
    expect(m).toContain("GRANT ALL ON public.investment_reports TO service_role");
    expect(m).toContain("'investment_recommendations', 'investment_reports',");
    const h = readFileSync("supabase/functions/review-agent-admin/index.ts", "utf8");
    for (const a of ["invRepList", "invRepPreview", "invRepFile", "invRepShare", "invRepUnshare"]) expect(h).toContain(`"${a}"`);
    expect(readFileSync("src/App.tsx", "utf8")).toContain('<Route path="report" element={<InvReport />} />');
    expect(readFileSync("src/modules/investments/InvestmentLayout.tsx", "utf8")).toContain('label: "Client report"');
    expect(readFileSync("supabase/functions/_shared/investment-service.ts", "utf8")).not.toMatch(/insurance_reports|insurance_files|insurance_quotes/);
  });
});
