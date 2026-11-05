// Georgia's portal autonomy page: the labels, and what the shadow review adds up to. Pure; no I/O.
import { CATEGORIES, type Category, type Mode } from "../../../../supabase/functions/_shared/georgia-triage";

export { CATEGORIES };
export type { Category, Mode };

export const CATEGORY_LABEL: Record<Category, string> = {
  status: "Status and where-is-my questions",
  documents: "Pointing to a document in My Documents",
  meetings: "Meeting logistics",
  ia_self_serve: "iA self-serve (deposits, insurance banking and payment changes)",
  contact_details: "Contact-detail updates",
};

/** Only these two do anything yet: draft and auto arrive with the stages after shadow. */
export const MODES_AVAILABLE: Mode[] = ["off", "shadow"];
export const MODE_LABEL: Record<Mode, string> = { off: "Off", shadow: "Shadow: record only", draft: "Draft (not built yet)", auto: "Automatic (not built yet)" };

export interface ReviewRow { category: string; verdict?: "right" | "wrong" | null; wouldBe?: string | null }
export interface CategoryTally { category: string; total: number; right: number; wrong: number; unreviewed: number; /** Share of the reviewed ones that were right, or null when none are reviewed. */ rightRate: number | null }

/** Adds the shadow review up by category, in the page's order, with the ones Georgia would not have handled left out of the rate. */
export function tally(rows: ReviewRow[]): CategoryTally[] {
  const order: string[] = [...CATEGORIES, "none"];
  const by = new Map<string, CategoryTally>(order.map((c) => [c, { category: c, total: 0, right: 0, wrong: 0, unreviewed: 0, rightRate: null }]));
  for (const r of rows) {
    const t = by.get(r.category) ?? { category: r.category, total: 0, right: 0, wrong: 0, unreviewed: 0, rightRate: null };
    t.total += 1;
    if (r.verdict === "right") t.right += 1; else if (r.verdict === "wrong") t.wrong += 1; else t.unreviewed += 1;
    by.set(r.category, t);
  }
  return [...by.values()].filter((t) => t.total > 0).map((t) => ({ ...t, rightRate: t.right + t.wrong > 0 ? t.right / (t.right + t.wrong) : null }));
}

/** A category is ready to move on when enough have been reviewed and almost none were wrong: 20 reviewed and at least 95% right. */
export const READY_MIN_REVIEWED = 20;
export const READY_MIN_RATE = 0.95;
export const readyToGraduate = (t: CategoryTally): boolean => t.right + t.wrong >= READY_MIN_REVIEWED && (t.rightRate ?? 0) >= READY_MIN_RATE;
