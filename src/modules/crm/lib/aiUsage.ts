// AI usage page arithmetic: what the logged token counts cost. Pure; no I/O.
// Rates are CAD per million tokens. Gemini 3.5 Flash is worked back from Google's 30-day report to 2026-11-02 (input 17.60 over 7.53M tokens, output 20.48
// over 1.46M, cache reads 3.65 over 15.61M); the 2.5 models are their list prices in CAD. They are estimates: the Google invoice is the figure that counts.

export interface Rates { input: number; cached: number; output: number }
export const RATES: Record<string, Rates> = {
  "gemini-3.5-flash": { input: 2.34, cached: 0.234, output: 14.02 },
  "gemini-2.5-flash": { input: 0.41, cached: 0.041, output: 3.43 },
  "gemini-2.5-pro": { input: 1.71, cached: 0.171, output: 13.7 },
};
const FALLBACK = RATES["gemini-3.5-flash"];

export interface UsageGroup { label: string; model: string; calls: number; prompt_tokens: number; cached_tokens: number; output_tokens: number; thinking_tokens: number }

/** Thinking is billed as output, and cached tokens are billed at the cache rate instead of the input rate. */
export function costCad(g: Pick<UsageGroup, "model" | "prompt_tokens" | "cached_tokens" | "output_tokens" | "thinking_tokens">): number {
  const r = RATES[g.model] ?? FALLBACK;
  const billedInput = Math.max(g.prompt_tokens - g.cached_tokens, 0);
  return (billedInput * r.input + g.cached_tokens * r.cached + (g.output_tokens + g.thinking_tokens) * r.output) / 1_000_000;
}

export interface Total { key: string; calls: number; input: number; cached: number; output: number; cost: number }

/** Adds groups up by a key (a feature, a model or a day), costliest first. */
export function totalsBy<T extends UsageGroup>(rows: T[], key: (r: T) => string): Total[] {
  const m = new Map<string, Total>();
  for (const r of rows) {
    const k = key(r);
    const t = m.get(k) ?? { key: k, calls: 0, input: 0, cached: 0, output: 0, cost: 0 };
    t.calls += r.calls;
    t.input += Math.max(r.prompt_tokens - r.cached_tokens, 0);
    t.cached += r.cached_tokens;
    t.output += r.output_tokens + r.thinking_tokens;
    t.cost += costCad(r);
    m.set(k, t);
  }
  return [...m.values()].sort((a, b) => b.cost - a.cost || a.key.localeCompare(b.key));
}
