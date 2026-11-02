// ai-usage-briefing.ts: the Monday line about last week's AI cost. Pure; no I/O. Built from the logged token counts, never reworded by the model,
// so the figures Rolf reviews with Georgia are the ones on the AI usage page.

import { costCad, totalsBy, type UsageGroup } from "./ai-usage-cost.ts";

export interface DayGroup extends UsageGroup { day: string }
export interface BriefingItem { key: string; label: string; link: string }

const dayNumber = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10), 12) / 86_400_000;
const fromNumber = (n: number) => new Date(n * 86_400_000).toISOString().slice(0, 10);

/** 0 = Sunday .. 6 = Saturday, for a calendar date. */
export const weekday = (d: string): number => new Date(dayNumber(d) * 86_400_000).getUTCDay();

/** The Monday-to-Sunday week before the one `today` falls in. */
export function previousWeek(today: string): { start: string; end: string } {
  const sinceMonday = (weekday(today) + 6) % 7;
  const thisMonday = dayNumber(today) - sinceMonday;
  return { start: fromNumber(thisMonday - 7), end: fromNumber(thisMonday - 1) };
}

export interface WeekSummary { start: string; end: string; calls: number; cost: number; before: number | null; top: { label: string; cost: number }[] }

const inRange = (rows: DayGroup[], a: string, b: string) => rows.filter((r) => r.day >= a && r.day <= b);
const cost = (rows: DayGroup[]) => rows.reduce((t, r) => t + costCad(r), 0);

/** Last week's cost, the week before for comparison (null when nothing was logged then), and the three costliest files. */
export function summarizeWeek(rows: DayGroup[], today: string): WeekSummary {
  const w = previousWeek(today);
  const last = inRange(rows, w.start, w.end);
  const prevStart = fromNumber(dayNumber(w.start) - 7), prevEnd = fromNumber(dayNumber(w.start) - 1);
  const prev = inRange(rows, prevStart, prevEnd);
  return {
    ...w,
    calls: last.reduce((t, r) => t + r.calls, 0),
    cost: cost(last),
    before: prev.length ? cost(prev) : null,
    top: totalsBy(last, (r) => r.label).slice(0, 3).map((t) => ({ label: t.key, cost: t.cost })),
  };
}

const money = (n: number) => `$${n.toFixed(2)}`;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const short = (d: string) => `${MONTHS[+d.slice(5, 7) - 1]} ${+d.slice(8, 10)}`;

/** The briefing item, or null on any day but Monday and when nothing was logged last week. */
export function usageBriefingItem(rows: DayGroup[], today: string): BriefingItem | null {
  if (weekday(today) !== 1) return null;
  const s = summarizeWeek(rows, today);
  if (s.calls === 0) return null;
  const change = s.before === null || s.before <= 0 ? "" : s.cost >= s.before ? `, up ${Math.round(((s.cost - s.before) / s.before) * 100)}% on the week before` : `, down ${Math.round(((s.before - s.cost) / s.before) * 100)}% on the week before`;
  const top = s.top.length ? ` Most: ${s.top.map((t) => `${t.label} ${money(t.cost)}`).join(", ")}.` : "";
  return {
    key: `aiusage:${s.start}`,
    label: `AI cost last week (${short(s.start)} to ${short(s.end)}): about ${money(s.cost)} CAD over ${s.calls.toLocaleString("en-CA")} calls${change}.${top}`,
    link: "/ai-usage",
  };
}
