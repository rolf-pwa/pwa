import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { previousWeek, summarizeWeek, usageBriefingItem, weekday, type DayGroup } from "../../supabase/functions/_shared/ai-usage-briefing";

// 2026-11-09 is a Monday: last week is Mon Nov 2 to Sun Nov 8; the week before is Oct 26 to Nov 1.
const g = (day: string, label: string, calls: number, prompt: number, extra: Partial<DayGroup> = {}): DayGroup => ({ day, label, model: "gemini-3.5-flash", calls, prompt_tokens: prompt, cached_tokens: 0, output_tokens: 0, thinking_tokens: 0, ...extra });

describe("which week is last week", () => {
  it("is the Monday-to-Sunday week before the one today falls in, from any day", () => {
    expect(weekday("2026-11-09")).toBe(1);
    expect(previousWeek("2026-11-09")).toEqual({ start: "2026-11-02", end: "2026-11-08" });
    expect(previousWeek("2026-11-15")).toEqual({ start: "2026-11-02", end: "2026-11-08" });
    expect(previousWeek("2026-11-01")).toEqual({ start: "2026-10-19", end: "2026-10-25" });
  });
  it("crosses a year end", () => {
    expect(previousWeek("2027-01-04")).toEqual({ start: "2026-12-28", end: "2027-01-03" });
  });
});

describe("the week's summary", () => {
  const rows = [
    g("2026-11-03", "_shared/notice-service.ts", 10, 1_000_000), g("2026-11-05", "_shared/georgia-llm.ts", 5, 3_000_000),
    g("2026-11-08", "_shared/notice-service.ts", 4, 1_000_000), g("2026-11-09", "_shared/notice-service.ts", 99, 9_000_000), g("2026-10-28", "_shared/georgia-llm.ts", 3, 2_000_000),
  ];
  it("counts only last week's days, ranks the costliest files, and compares with the week before", () => {
    const s = summarizeWeek(rows, "2026-11-09");
    expect(s.calls).toBe(19);
    expect(s.cost).toBeCloseTo(5 * 2.34, 2);
    expect(s.before).toBeCloseTo(2 * 2.34, 2);
    expect(s.top.map((t) => t.label)).toEqual(["_shared/georgia-llm.ts", "_shared/notice-service.ts"]);
  });
  it("has no comparison when nothing was logged the week before", () => {
    expect(summarizeWeek(rows.filter((r) => r.day >= "2026-11-02"), "2026-11-09").before).toBeNull();
  });
});

describe("the Monday briefing line", () => {
  const rows = [g("2026-11-03", "_shared/notice-service.ts", 10, 1_000_000), g("2026-10-28", "_shared/notice-service.ts", 3, 1_000_000)];
  it("is on Mondays only, keyed to the week, linking to the usage page", () => {
    const item = usageBriefingItem(rows, "2026-11-09")!;
    expect(item.key).toBe("aiusage:2026-11-02");
    expect(item.link).toBe("/ai-usage");
    expect(item.label).toContain("AI cost last week (Nov 2 to Nov 8): about $2.34 CAD over 10 calls");
    expect(item.label).toContain("Most: _shared/notice-service.ts $2.34.");
    expect(usageBriefingItem(rows, "2026-11-10")).toBeNull();
  });
  it("says up or down against the week before, and nothing when there is no earlier week", () => {
    const up = [g("2026-11-03", "a.ts", 1, 2_000_000), g("2026-10-28", "a.ts", 1, 1_000_000)];
    expect(usageBriefingItem(up, "2026-11-09")!.label).toContain("up 100% on the week before");
    const down = [g("2026-11-03", "a.ts", 1, 1_000_000), g("2026-10-28", "a.ts", 1, 2_000_000)];
    expect(usageBriefingItem(down, "2026-11-09")!.label).toContain("down 50% on the week before");
    expect(usageBriefingItem([g("2026-11-03", "a.ts", 1, 1_000_000)], "2026-11-09")!.label).not.toContain("week before");
  });
  it("is left off when nothing was logged last week", () => {
    expect(usageBriefingItem([g("2026-10-28", "a.ts", 3, 1_000_000)], "2026-11-09")).toBeNull();
  });
});

describe("wiring", () => {
  const read = (p: string) => readFileSync(p, "utf8");
  it("the briefing gathers it into the firm tile, and a failure leaves it off", () => {
    const src = read("supabase/functions/daily-briefing-generate/index.ts");
    expect(src).toContain('db.rpc("ai_usage_summary", { days: 21 })');
    expect(src).toContain("...firm.aiUsage,");
    expect(src).toContain('console.error("[briefing] ai usage"');
  });
  it("Georgia mentions it on Mondays, and the page shares the cost arithmetic", () => {
    expect(read("supabase/functions/_shared/ea-agent.ts")).toContain("has an AI cost line, mention it");
    expect(read("src/modules/crm/lib/aiUsage.ts")).toContain("_shared/ai-usage-cost");
  });
});
