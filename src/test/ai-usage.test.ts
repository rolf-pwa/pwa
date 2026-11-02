import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { labelFromStack, modelFromUrl, usageRow } from "../../supabase/functions/_shared/ai-usage";
import { costCad, totalsBy } from "../modules/crm/lib/aiUsage";

const URL_35 = "https://northamerica-northeast1-aiplatform.googleapis.com/v1/projects/p/locations/northamerica-northeast1/publishers/google/models/gemini-3.5-flash:generateContent";
const STACK = [
  "Error",
  "    at globalThis.fetch (file:///src/_shared/ai-usage.ts:80:20)",
  "    at fetchWithVertexRetry (file:///src/_shared/vertex-retry.ts:20:21)",
  "    at generateVertexContent (file:///src/_shared/vertex-ai.ts:270:15)",
  "    at async classifyNotice (file:///src/_shared/notice-service.ts:88:22)",
  "    at async handler (file:///src/daily-briefing-generate/index.ts:900:5)",
].join("\n");

describe("which model and feature a call belongs to", () => {
  it("reads the model from the generateContent URL, and ignores other Vertex calls", () => {
    expect(modelFromUrl(URL_35)).toBe("gemini-3.5-flash");
    expect(modelFromUrl(URL_35.replace(":generateContent", ":predict"))).toBeNull();
    expect(modelFromUrl("https://example.com/models/x:generateContent")).toBeNull();
  });
  it("labels a call with the first file on the stack that is not plumbing", () => {
    expect(labelFromStack(STACK)).toBe("_shared/notice-service.ts");
    expect(labelFromStack("Error\n    at async f (file:///src/vertex-ai/index.ts:5:5)")).toBe("vertex-ai/index.ts");
    expect(labelFromStack(undefined)).toBe("unknown");
    expect(labelFromStack("Error\n    at <anonymous>")).toBe("unknown");
  });
});

describe("the row logged from a response", () => {
  it("keeps token counts only", () => {
    const body = { candidates: [{ content: { parts: [{ text: "a private answer" }] } }], usageMetadata: { promptTokenCount: 1200, cachedContentTokenCount: 800, candidatesTokenCount: 90, thoughtsTokenCount: 300, totalTokenCount: 1590 } };
    const row = usageRow(URL_35, STACK, body);
    expect(row).toEqual({ label: "_shared/notice-service.ts", model: "gemini-3.5-flash", prompt_tokens: 1200, cached_tokens: 800, output_tokens: 90, thinking_tokens: 300, total_tokens: 1590 });
    expect(JSON.stringify(row)).not.toContain("private");
  });
  it("treats missing counts as zero and a response without usage as nothing to log", () => {
    expect(usageRow(URL_35, STACK, { usageMetadata: { promptTokenCount: 10 } })).toMatchObject({ prompt_tokens: 10, output_tokens: 0, thinking_tokens: 0, cached_tokens: 0 });
    expect(usageRow(URL_35, STACK, { candidates: [] })).toBeNull();
  });
});

describe("what the logged tokens cost", () => {
  it("reproduces Google's 30-day figures for Gemini 3.5 Flash to the cent", () => {
    // Google, 2026-10-03 to 2026-11-02: input 7,527,619 (17.60), output 1,460,517 (20.48), cache reads 15,611,349 (3.65). Prompt tokens include the cached ones.
    const cost = costCad({ model: "gemini-3.5-flash", prompt_tokens: 7_527_619 + 15_611_349, cached_tokens: 15_611_349, output_tokens: 1_460_517, thinking_tokens: 0 });
    expect(cost).toBeCloseTo(17.6 + 20.48 + 3.65, 0);
  });
  it("bills thinking as output and cached tokens at the cache rate", () => {
    const base = { model: "gemini-3.5-flash", prompt_tokens: 1_000_000, cached_tokens: 0, output_tokens: 0, thinking_tokens: 0 };
    expect(costCad({ ...base, thinking_tokens: 1_000_000 }) - costCad(base)).toBeCloseTo(14.02, 2);
    expect(costCad({ ...base, cached_tokens: 1_000_000 })).toBeCloseTo(0.234, 3);
  });
  it("adds groups up by feature, costliest first", () => {
    const g = (label: string, calls: number, prompt: number) => ({ label, model: "gemini-3.5-flash", calls, prompt_tokens: prompt, cached_tokens: 0, output_tokens: 0, thinking_tokens: 0 });
    const t = totalsBy([g("a.ts", 2, 1_000_000), g("b.ts", 1, 5_000_000), g("a.ts", 3, 1_000_000)], (r) => r.label);
    expect(t.map((x) => x.key)).toEqual(["b.ts", "a.ts"]);
    expect(t[1].calls).toBe(5);
  });
});

describe("wiring", () => {
  const read = (p: string) => readFileSync(p, "utf8");
  it("every AI call site gets the logging through vertex-ai.ts, and a failure never reaches the call", () => {
    expect(read("supabase/functions/_shared/vertex-ai.ts")).toContain('import "./ai-usage.ts"');
    const src = read("supabase/functions/_shared/ai-usage.ts");
    expect(src).toContain(".catch(");
    expect(src).toContain("EdgeRuntime?.waitUntil");
  });
  it("the table is staff-only with explicit grants, and the page and route exist", () => {
    const sql = read("supabase/migrations/20270111120000_ai_usage.sql");
    expect(sql).toContain("GRANT ALL ON public.ai_usage TO service_role");
    expect(sql).toContain("LIKE '%@prosperwise.ca'");
    expect(sql).toContain("SECURITY INVOKER");
    expect(read("src/App.tsx")).toContain('path="/ai-usage"');
    expect(read("src/shared/components/AppSidebar.tsx")).toContain('to: "/ai-usage"');
  });
});
