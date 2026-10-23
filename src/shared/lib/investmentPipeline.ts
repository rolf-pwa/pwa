// investmentPipeline.ts: the stages a segregated funds client moves through (the same as Insurance, the last named for investments). Pure.
export const INVESTMENT_STAGES = [
  { key: "new_lead", label: "New Lead" },
  { key: "discovery", label: "Discovery" },
  { key: "needs_analysis", label: "Needs Analysis" },
  { key: "recommendation", label: "Recommendation" },
  { key: "investment_agreed", label: "Investment Agreed" },
] as const;
export type InvestmentStage = (typeof INVESTMENT_STAGES)[number]["key"];
export const investmentStageLabel = (k: string) => INVESTMENT_STAGES.find((s) => s.key === k)?.label ?? k;
