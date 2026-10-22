// insuranceRoadmap.ts: the compliance roadmap for an insurance file. Each required checklist item belongs to the stage where it is normally done; what is not
// done yet is "up next" when its stage has been reached (the Discovery items are up next from the first day) and "later" otherwise. Pure.
import { INSURANCE_STAGES, type InsuranceStage } from "./insurancePipeline";

export const ITEM_STAGE: Record<string, InsuranceStage> = {
  advisor_disclosure: "discovery",
  privacy_consent: "discovery",
  fact_find: "discovery",
  meeting_records: "discovery",
  needs_analysis: "needs_analysis",
  alternatives: "recommendation",
  recommendation: "recommendation",
  illustration: "recommendation",
  replacement_disclosure: "recommendation",
  application: "coverage_agreed",
  delivery_confirmation: "coverage_agreed",
};
const order = (s: InsuranceStage) => INSURANCE_STAGES.findIndex((x) => x.key === s);
export const itemStage = (kind: string): InsuranceStage => ITEM_STAGE[kind] ?? "coverage_agreed";

export interface ChecklistLike { kind: string; label: string; hint: string; done: boolean }
export interface RoadmapItem extends ChecklistLike { stage: InsuranceStage }
export interface Roadmap { upNext: RoadmapItem[]; later: RoadmapItem[]; completed: RoadmapItem[]; total: number; done: number; percent: number }

export function roadmap(required: ChecklistLike[], current: InsuranceStage | null): Roadmap {
  const reached = Math.max(order(current ?? "new_lead"), order("discovery"));
  const items = required.map((c, i) => ({ ...c, stage: itemStage(c.kind), i })).sort((a, b) => order(a.stage) - order(b.stage) || a.i - b.i);
  const upNext = items.filter((c) => !c.done && order(c.stage) <= reached);
  const later = items.filter((c) => !c.done && order(c.stage) > reached);
  const completed = items.filter((c) => c.done);
  const total = items.length;
  const strip = ({ i: _i, ...c }: (typeof items)[number]): RoadmapItem => c;
  return { upNext: upNext.map(strip), later: later.map(strip), completed: completed.map(strip), total, done: completed.length, percent: total === 0 ? 100 : Math.round((completed.length / total) * 100) };
}

export interface ActivityFile { id: string; title: string; opened_at: string; packaged_at: string | null; items: { kind: string; status: string; drive_name: string | null; added_by: string | null; added_at: string }[] }
export interface ActivityEvent { at: string; text: string }
/** What has happened on the household's insurance files, newest first. */
export function activity(files: ActivityFile[], labelOf: (kind: string) => string, limit = 10): ActivityEvent[] {
  const ev: ActivityEvent[] = [];
  for (const f of files) {
    ev.push({ at: f.opened_at, text: `Opened the file ${f.title}` });
    if (f.packaged_at) ev.push({ at: f.packaged_at, text: `Built the audit package for ${f.title}` });
    for (const i of f.items) ev.push({ at: i.added_at, text: i.status === "not_applicable" ? `Marked ${labelOf(i.kind)} not applicable` : `Added ${labelOf(i.kind)}${i.drive_name ? ` (${i.drive_name})` : ""}` });
  }
  return ev.sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, limit);
}
