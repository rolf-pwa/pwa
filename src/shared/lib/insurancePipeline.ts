// insurancePipeline.ts: the stages an insurance client moves through. Pure.
export const INSURANCE_STAGES = [
  { key: "new_lead", label: "New Lead" },
  { key: "discovery", label: "Discovery" },
  { key: "needs_analysis", label: "Needs Analysis" },
  { key: "recommendation", label: "Recommendation" },
  { key: "coverage_agreed", label: "Coverage Agreed" },
] as const;
export type InsuranceStage = (typeof INSURANCE_STAGES)[number]["key"];
export const stageLabel = (k: string) => INSURANCE_STAGES.find((s) => s.key === k)?.label ?? k;
export const isStage = (k: unknown): k is InsuranceStage => INSURANCE_STAGES.some((s) => s.key === k);
