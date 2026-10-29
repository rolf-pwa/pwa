import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const fn = readFileSync("supabase/functions/daily-briefing-generate/index.ts", "utf8");
const gen = fn.slice(fn.indexOf("const ask = ()"), fn.indexOf("// Resolve each cited fact_index"));

describe("the morning briefing's AI call", () => {
  it("has a generous output cap, because Gemini 3's thinking shares it (a cap of 2048 could run out before the function call)", () => {
    expect(fn).toContain("const BRIEFING_MAX_OUTPUT_TOKENS = 8192");
    expect(gen).toContain("maxOutputTokens: BRIEFING_MAX_OUTPUT_TOKENS");
    expect(fn).not.toMatch(/populate_daily_briefing[\s\S]{0,400}maxOutputTokens: 2048/);
  });
  it("asks once more when the answer has no function call, and says why when it still fails", () => {
    expect(gen.match(/await ask\(\)/g)?.length).toBe(2);
    expect(gen).toContain("no function call, trying once more");
    expect(gen).toContain("AI did not return structured data (${briefingFinish(result)})");
    expect(fn).toContain("finishReason");
  });
});
