// Book of Business page ordering. Pure; no I/O.

export type Confidence = "high" | "medium" | "low";
export interface DatedOpp { due_on: string | null; confidence: Confidence }

const RANK: Record<Confidence, number> = { high: 0, medium: 1, low: 2 };

/** The soonest date among opportunities that have one (ISO dates compare as text). */
export const earliestDue = (opps: { due_on: string | null }[]): string | null =>
  opps.reduce<string | null>((best, o) => (o.due_on && (!best || o.due_on < best) ? o.due_on : best), null);

/** One household's opportunities: by confidence, or by date with undated ones last (surest first within a date). */
export function orderOpps<T extends DatedOpp>(opps: T[], mode: "confidence" | "date"): T[] {
  return [...opps].sort((a, b) => {
    if (mode === "date") {
      if (a.due_on !== b.due_on) return !a.due_on ? 1 : !b.due_on ? -1 : a.due_on < b.due_on ? -1 : 1;
    }
    return RANK[a.confidence] - RANK[b.confidence];
  });
}

/**
 * The household list: by how many opportunities are shown, or by the soonest date among them. In date order households with no dated
 * opportunity come after those that have one, in the usual order.
 */
export function orderHouseholds<T extends { householdId: string; label: string }>(rows: T[], shown: Map<string, { due_on: string | null }[]>, mode: "most" | "date"): T[] {
  const count = (h: T) => shown.get(h.householdId)?.length ?? 0;
  const due = (h: T) => earliestDue(shown.get(h.householdId) ?? []);
  return [...rows].sort((a, b) => {
    if (mode === "date") {
      const da = due(a), db = due(b);
      if (da !== db) return !da ? 1 : !db ? -1 : da < db ? -1 : 1;
    }
    return count(b) - count(a) || a.label.localeCompare(b.label);
  });
}
