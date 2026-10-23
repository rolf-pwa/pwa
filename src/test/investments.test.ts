import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CHECKLIST, DISCLOSURE_ITEMS, checklistFor, fileStatus } from "../../supabase/functions/_shared/investment-file-rules";
import { cleanProfile, EMPTY_PROFILE as SERVER_EMPTY, GUARANTEE as S_GUARANTEE, KNOWLEDGE as S_KNOWLEDGE, OBJECTIVES as S_OBJECTIVES, STABILITY as S_STABILITY, profileBlocks, profileGaps as serverGaps } from "../../supabase/functions/_shared/investment-profile-rules";
import { EMPTY_PROFILE, GUARANTEE, KNOWLEDGE, OBJECTIVES, STABILITY, profileGaps } from "@/shared/lib/investorProfile";
import { INVESTMENT_STAGES } from "@/shared/lib/investmentPipeline";
import { INSURANCE_STAGES } from "@/shared/lib/insurancePipeline";
import { ITEM_STAGE, roadmap } from "@/shared/lib/investmentRoadmap";
import { conventionFile, DOC_FILE_NAME } from "../../supabase/functions/_shared/file-naming";

const MODEL = { profile_key: "balanced", label: "Balanced", income_min: 35, income_max: 55, equity_min: 45, equity_max: 65 };

describe("the MGA's checklist", () => {
  it("has the six items for a new sale, in the MGA's terms", () => {
    expect(checklistFor("new_sale").map((c) => c.kind)).toEqual(["advisor_disclosure", "privacy_consent", "casl_consent", "fact_find", "reason_why", "advisor_notes"]);
    expect(checklistFor("new_sale").map((c) => c.label)).toEqual(["Advisor disclosure", "Privacy consent", "CASL consent", "Fact find, needs analysis and risk tolerance", "Reason why letter", "Advisor notes"]);
  });
  it("asks only for the profile and notes at a review, and keeps the rest optional", () => {
    expect(checklistFor("review").map((c) => c.kind)).toEqual(["fact_find", "advisor_notes"]);
    expect(CHECKLIST.filter((c) => c.requiredFor.length === 0).map((c) => c.kind)).toEqual(["application", "contract_delivery", "other"]);
  });
  it("counts items covered by the signed disclosure or the saved profile as done", () => {
    expect(fileStatus("new_sale", []).done).toBe(0);
    const s = fileStatus("new_sale", [{ kind: "advisor_notes", status: "provided" }], [...DISCLOSURE_ITEMS, "fact_find"]);
    expect(s.done).toBe(5);
    expect(s.missing.map((m) => m.kind)).toEqual(["reason_why"]);
    expect(fileStatus("new_sale", [{ kind: "reason_why", status: "not_applicable" }], [...DISCLOSURE_ITEMS, "fact_find", "advisor_notes"]).complete).toBe(true);
  });
});

describe("stages and the roadmap", () => {
  it("are the same stages as Insurance, the last named for investments", () => {
    expect(INVESTMENT_STAGES.slice(0, 4)).toEqual(INSURANCE_STAGES.slice(0, 4));
    expect(INVESTMENT_STAGES[4]).toEqual({ key: "investment_agreed", label: "Investment Agreed" });
  });
  it("puts the disclosure items in Discovery and the letter in Recommendation, and holds later items back", () => {
    for (const k of ["advisor_disclosure", "privacy_consent", "casl_consent", "advisor_notes"]) expect(ITEM_STAGE[k]).toBe("discovery");
    const items = checklistFor("new_sale").map((c) => ({ kind: c.kind, label: c.label, hint: c.hint, done: false }));
    const r = roadmap(items, "new_lead");
    expect(r.upNext.map((c) => c.kind)).toEqual(["advisor_disclosure", "privacy_consent", "casl_consent", "advisor_notes"]);
    expect(r.later.map((c) => c.kind)).toEqual(["fact_find", "reason_why"]);
    expect(roadmap(items.map((c) => ({ ...c, done: true })), "new_lead").percent).toBe(100);
  });
});

describe("the investor profile", () => {
  it("keeps only the known fields in the known shapes", () => {
    const c = cleanProfile({ objectives: ["growth", "bogus", "growth"], timeHorizonYears: 500, amountToInvest: "250000", incomeStability: "nope", knowledge: "good", riskProfile: "Balanced!!", riskProfileDate: "yesterday", extra: "x", concerns: "y".repeat(5000) });
    expect(c.objectives).toEqual(["growth"]);
    expect(c.timeHorizonYears).toBe(80);
    expect(c.amountToInvest).toBe(250000);
    expect(c.incomeStability).toBe("");
    expect(c.knowledge).toBe("good");
    expect(c.riskProfile).toBe("");
    expect(c.riskProfileDate).toBe("");
    expect(c.concerns).toHaveLength(1500);
    expect(c as any).not.toHaveProperty("extra");
    expect(cleanProfile(null)).toEqual(SERVER_EMPTY);
    expect(cleanProfile({ riskProfile: "balanced", riskProfileDate: "2026-10-24" })).toMatchObject({ riskProfile: "balanced", riskProfileDate: "2026-10-24" });
  });
  it("lists what is missing, the risk profile last", () => {
    expect(serverGaps(SERVER_EMPTY)).toEqual(["the objectives", "the time horizon", "the amount to invest", "income", "investment knowledge", "the risk profile from the iA investor profile"]);
    expect(serverGaps({ ...SERVER_EMPTY, objectives: ["growth"], timeHorizonYears: 10, amountToInvest: 1, annualIncome: 1, knowledge: "good" })).toEqual(["the risk profile from the iA investor profile"]);
  });
  it("is the same on the client as on the server", () => {
    expect([OBJECTIVES, STABILITY, KNOWLEDGE, GUARANTEE, EMPTY_PROFILE]).toEqual([S_OBJECTIVES, S_STABILITY, S_KNOWLEDGE, S_GUARANTEE, SERVER_EMPTY]);
    expect(profileGaps({ ...EMPTY_PROFILE, annualIncome: 5 })).toEqual(serverGaps({ ...SERVER_EMPTY, annualIncome: 5 }));
  });
  it("reports the profile with the iA model mix, and says when the risk profile is not recorded", () => {
    const inputs = cleanProfile({ objectives: ["growth", "income"], timeHorizonYears: 15, amountToInvest: 200000, annualIncome: 120000, incomeStability: "stable", currentInvestments: 300000, liabilities: 50000, knowledge: "good", riskProfile: "balanced", riskProfileDate: "2026-10-24", riskProfileEvidence: "iA application signed Oct 24" });
    const t = JSON.stringify(profileBlocks({ inputs, person: "Justin Santos", savedAt: "2026-10-24T18:00:00Z", note: null, model: MODEL }));
    for (const s of ["Grow capital; Generate income", "15 years", "$200,000", "$250,000", "Balanced", "35% to 55% fixed income, 45% to 65% equity", "iA application signed Oct 24"]) expect(t).toContain(s);
    expect(JSON.stringify(profileBlocks({ inputs: SERVER_EMPTY, person: "X", savedAt: "2026-10-24T18:00:00Z", note: null, model: null }))).toContain("has not been recorded yet");
  });
  it("is filed under the naming convention", () => {
    expect(conventionFile("2026-10-24", [{ first_name: "Justin", last_name: "Santos" }], DOC_FILE_NAME.investor_profile)).toBe("26-10-24_Santos_J_Investor Profile and Needs Analysis.pdf");
  });
});

describe("kept apart from Insurance", () => {
  const svc = readFileSync("supabase/functions/_shared/investment-service.ts", "utf8");
  it("uses its own tables, and reads only the client's signed disclosure from Insurance", () => {
    for (const t of ["investment_files", "investment_file_items", "investment_profiles"]) expect(svc).toContain(t);
    expect(svc).not.toMatch(/insurance_files|insurance_file_items|insurance_pipeline|insurance_needs_analyses/);
    expect(svc.match(/"insurance_documents"/g)?.length).toBe(1); // the one lookup of the signed disclosure
  });
  it("has tables with grants, and the 7-year delete guard counts the client records", () => {
    const m = readFileSync("supabase/migrations/20261230120000_investments.sql", "utf8");
    for (const t of ["investment_pipeline", "investment_files", "investment_file_items", "investment_profiles"]) expect(m).toContain(`GRANT ALL ON public.${t} TO service_role`);
    expect(m).toContain("GRANT SELECT, INSERT, UPDATE, DELETE ON public.investment_pipeline TO authenticated");
    expect(m).toMatch(/'investment_files', 'investment_profiles',/);
    expect(m).toContain("recs := ARRAY['investment_profiles', 'insurance_policies'");
    expect(m).toContain("'investment_agreed'");
  });
  it("has its own routes, sidebar entry and handler actions", () => {
    const app = readFileSync("src/App.tsx", "utf8");
    for (const p of ['path="/investments"', 'path="profile"', 'path="compliance"']) expect(app).toContain(p);
    expect(readFileSync("src/shared/components/AppSidebar.tsx", "utf8")).toContain('to: "/investments", label: "Investments"');
    const h = readFileSync("supabase/functions/review-agent-admin/index.ts", "utf8");
    for (const a of ["invFiles", "invFileCreate", "invAttach", "invRemove", "invProfiles", "invProfileSave", "invProfileFile"]) expect(h).toContain(`"${a}"`);
  });
});
