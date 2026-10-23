// investorProfile.ts: the fields of the investor profile and needs analysis (segregated funds). Mirrors supabase/functions/_shared/investment-profile-rules.ts (a test keeps them in step).
export const OBJECTIVES: Record<string, string> = { growth: "Grow capital", income: "Generate income", preservation: "Preserve capital", estate: "Pass wealth to the family (estate)", tax: "Reduce tax" };
export const STABILITY: Record<string, string> = { stable: "Stable", variable: "Variable", unsure: "Not sure" };
export const KNOWLEDGE: Record<string, string> = { none: "None", limited: "Limited", good: "Good", extensive: "Extensive" };
export const GUARANTEE: Record<string, string> = { low: "Not important", medium: "Somewhat important", high: "Very important" };

export interface ProfileInputs {
  objectives: string[]; timeHorizonYears: number; amountToInvest: number; sourceOfFunds: string; accountTypes: string;
  annualIncome: number; incomeStability: string; currentInvestments: number; liabilities: number;
  liquidityNeedsAmount: number; liquidityNeedsWhen: string; knowledge: string; experienceYears: number; guaranteeImportance: string; concerns: string;
  riskProfile: string; riskProfileDate: string; riskProfileEvidence: string;
}
export const EMPTY_PROFILE: ProfileInputs = {
  objectives: [], timeHorizonYears: 0, amountToInvest: 0, sourceOfFunds: "", accountTypes: "", annualIncome: 0, incomeStability: "", currentInvestments: 0, liabilities: 0,
  liquidityNeedsAmount: 0, liquidityNeedsWhen: "", knowledge: "", experienceYears: 0, guaranteeImportance: "", concerns: "", riskProfile: "", riskProfileDate: "", riskProfileEvidence: "",
};

/** What is still to fill in. The risk profile is the one that usually is not known until the iA application. */
export function profileGaps(i: ProfileInputs): string[] {
  const g: string[] = [];
  if (!i.objectives.length) g.push("the objectives");
  if (!i.timeHorizonYears) g.push("the time horizon");
  if (!i.amountToInvest) g.push("the amount to invest");
  if (!i.annualIncome) g.push("income");
  if (!i.knowledge) g.push("investment knowledge");
  if (!i.riskProfile) g.push("the risk profile from the iA investor profile");
  return g;
}
