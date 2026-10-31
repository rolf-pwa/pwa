// opportunity-briefing.ts: which book-of-business opportunities go on the briefing. Pure; no I/O.
// Only what is new this week and still open, the surest first, a few at a time. The briefing never ranks these as today's priorities and the
// model never sees them: the line is built here from the stored finding, so nothing is reworded or invented.

export const BRIEFING_OPPORTUNITY_LIMIT = 3;
const NEW_WITHIN_DAYS = 7;

export interface OpportunityRow { id: string; household_id: string; title: string; confidence: "high" | "medium" | "low"; first_seen: string; status: string }

const RANK = { high: 0, medium: 1, low: 2 } as const;
const daysAgo = (today: string, n: number) => new Date(Date.parse(`${today}T12:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);

/** Open opportunities first seen in the last week: the top few, and how many more there are. */
export function pickBriefingOpportunities<T extends OpportunityRow>(rows: T[], today: string, limit = BRIEFING_OPPORTUNITY_LIMIT): { top: T[]; more: number; total: number } {
  const since = daysAgo(today, NEW_WITHIN_DAYS);
  const fresh = rows
    .filter((r) => r.status === "open" && r.first_seen >= since)
    .sort((a, b) => RANK[a.confidence] - RANK[b.confidence] || b.first_seen.localeCompare(a.first_seen) || a.title.localeCompare(b.title));
  return { top: fresh.slice(0, limit), more: Math.max(0, fresh.length - limit), total: fresh.length };
}

export interface BriefingItem { key: string; label: string; link: string }

/** The firm-tile items: one per top opportunity (with its household), then a single "and N more" line when there are others. */
export function briefingItems(top: (OpportunityRow & { householdLabel: string })[], more: number): BriefingItem[] {
  const items: BriefingItem[] = top.map((o) => ({
    key: `opp:${o.id}`,
    label: `Book of Business, ${o.householdLabel}: ${o.title}`,
    link: `/book-of-business?household=${o.household_id}`,
  }));
  if (more > 0) items.push({ key: "opp:more", label: moreLabel(more), link: "/book-of-business" });
  return items;
}

export const moreLabel = (n: number) => `Book of Business: ${n} more new ${n === 1 ? "opportunity" : "opportunities"} this week`;
