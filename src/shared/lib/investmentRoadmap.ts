// investmentRoadmap.ts: the compliance roadmap for a segregated funds file. Each required checklist item belongs to the stage where it is normally done; what is
// not done yet is "up next" once its stage has been reached (the Discovery items from the first day) and "later" before. Pure.
import { INVESTMENT_STAGES, type InvestmentStage } from "./investmentPipeline";

export const ITEM_STAGE: Record<string, InvestmentStage> = {
  advisor_disclosure: "discovery", privacy_consent: "discovery", casl_consent: "discovery", advisor_notes: "discovery",
  fact_find: "needs_analysis",
  reason_why: "recommendation",
  application: "investment_agreed", contract_delivery: "investment_agreed",
};
const order = (s: InvestmentStage) => INVESTMENT_STAGES.findIndex((x) => x.key === s);
export const itemStage = (kind: string): InvestmentStage => ITEM_STAGE[kind] ?? "investment_agreed";

export interface ChecklistLike { kind: string; label: string; hint: string; done: boolean; covered?: boolean }
export interface RoadmapItem extends ChecklistLike { stage: InvestmentStage }
export interface Roadmap { upNext: RoadmapItem[]; later: RoadmapItem[]; completed: RoadmapItem[]; total: number; done: number; percent: number }

export function roadmap(required: ChecklistLike[], current: InvestmentStage | null): Roadmap {
  const reached = Math.max(order(current ?? "new_lead"), order("discovery"));
  const items = required.map((c, i) => ({ ...c, stage: itemStage(c.kind), i })).sort((a, b) => order(a.stage) - order(b.stage) || a.i - b.i);
  const strip = ({ i: _i, ...c }: (typeof items)[number]): RoadmapItem => c;
  const upNext = items.filter((c) => !c.done && order(c.stage) <= reached), later = items.filter((c) => !c.done && order(c.stage) > reached), completed = items.filter((c) => c.done);
  return { upNext: upNext.map(strip), later: later.map(strip), completed: completed.map(strip), total: items.length, done: completed.length, percent: items.length === 0 ? 100 : Math.round((completed.length / items.length) * 100) };
}
