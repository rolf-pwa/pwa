
import { isVertexBusy, withModelFallback } from "../../supabase/functions/_shared/vertex-retry";
import { configFor } from "../../supabase/functions/_shared/vertex-ai";

describe("trying the fallback model when the main one stays busy", () => {
  const res = (status: number) => new Response("x", { status });
  it("knows which statuses mean busy", () => {
    expect(isVertexBusy(429)).toBe(true);
    expect(isVertexBusy(503)).toBe(true);
    expect(isVertexBusy(400)).toBe(false);
    expect(isVertexBusy(200)).toBe(false);
  });
  it("uses the main model when it answers", async () => {
    const seen: string[] = [];
    const r = await withModelFallback(async (m) => { seen.push(m); return res(200); }, "gemini-3.5-flash", "gemini-2.5-flash");
    expect(r.status).toBe(200);
    expect(seen).toEqual(["gemini-3.5-flash"]);
  });
  it("tries the fallback once when the main model is busy", async () => {
    const seen: string[] = [];
    const r = await withModelFallback(async (m) => { seen.push(m); return res(m === "gemini-3.5-flash" ? 429 : 200); }, "gemini-3.5-flash", "gemini-2.5-flash");
    expect(r.status).toBe(200);
    expect(seen).toEqual(["gemini-3.5-flash", "gemini-2.5-flash"]);
  });
  it("gives up after the fallback, and never retries a real error or the same model", async () => {
    const seen: string[] = [];
    expect((await withModelFallback(async (m) => { seen.push(m); return res(429); }, "a", "b")).status).toBe(429);
    expect(seen).toEqual(["a", "b"]);
    const bad: string[] = [];
    await withModelFallback(async (m) => { bad.push(m); return res(400); }, "a", "b");
    expect(bad).toEqual(["a"]);
    const same: string[] = [];
    await withModelFallback(async (m) => { same.push(m); return res(429); }, "a", "a");
    expect(same).toEqual(["a"]);
  });
  it("drops the 3.x thinking setting for a 2.5 model and keeps the rest", () => {
    const cfg = { temperature: 0.4, maxOutputTokens: 2048, thinkingConfig: { thinkingLevel: "low" } };
    expect(configFor("gemini-3.5-flash", cfg)).toEqual(cfg);
    expect(configFor("gemini-2.5-flash", cfg)).toEqual({ temperature: 0.4, maxOutputTokens: 2048 });
  });
});
