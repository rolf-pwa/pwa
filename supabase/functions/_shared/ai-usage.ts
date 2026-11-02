// ai-usage.ts: records what each Gemini call used, so the AI bill can be traced to a feature. Imported by vertex-ai.ts, which every AI call site uses,
// so one wrapper around fetch covers calls made through generateVertexContent and the ones that build their own request.
// Token counts only (from the response's usageMetadata): never the prompt or the answer. A failure here never touches the call.

export interface UsageRow {
  label: string;
  model: string;
  prompt_tokens: number;
  cached_tokens: number;
  output_tokens: number;
  thinking_tokens: number;
  total_tokens: number;
}

const GENERATE_URL = /aiplatform\.googleapis\.com\/.*\/models\/([^/:]+):generateContent/;
// Frames in these files are the plumbing, not the feature that made the call.
const PLUMBING = /\/(vertex-ai|vertex-retry|ai-usage)\.ts/;

export const modelFromUrl = (url: string): string | null => GENERATE_URL.exec(url)?.[1] ?? null;

/** The feature that made the call: the first file on the stack that is not plumbing, as its folder and name (for example _shared/notice-service.ts). */
export function labelFromStack(stack: string | undefined): string {
  for (const line of (stack ?? "").split("\n")) {
    if (PLUMBING.test(line)) continue;
    const m = /(?:file|https?):\/\/[^\s)]*?\/([^/\s)]+\/[^/\s)]+\.[tj]sx?)(?::\d+)/.exec(line);
    if (m) return m[1];
  }
  return "unknown";
}

const n = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : 0);

/** One row from a generateContent response body, or null when it carries no usage. */
export function usageRow(url: string, stack: string | undefined, body: unknown): UsageRow | null {
  const model = modelFromUrl(url);
  // deno-lint-ignore no-explicit-any
  const u = (body as any)?.usageMetadata;
  if (!model || !u) return null;
  return {
    label: labelFromStack(stack),
    model,
    prompt_tokens: n(u.promptTokenCount),
    cached_tokens: n(u.cachedContentTokenCount),
    output_tokens: n(u.candidatesTokenCount),
    thinking_tokens: n(u.thoughtsTokenCount),
    total_tokens: n(u.totalTokenCount),
  };
}

const INSTALLED = Symbol.for("prosperwise.ai-usage");

/** Wraps the global fetch once per isolate. Safe to call again, and does nothing outside Deno (tests). */
export function installAiUsageLogging(): void {
  // deno-lint-ignore no-explicit-any
  const g = globalThis as any;
  if (g[INSTALLED] || typeof g.Deno === "undefined") return;
  g[INSTALLED] = true;
  const original: typeof fetch = g.fetch.bind(globalThis);
  const supabaseUrl = g.Deno.env.get("SUPABASE_URL");
  const key = g.Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  const record = async (row: UsageRow) => {
    await original(`${supabaseUrl}/rest/v1/ai_usage`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: key, Authorization: `Bearer ${key}`, Prefer: "return=minimal" },
      body: JSON.stringify(row),
    });
  };

  g.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    // The stack is taken before the call: after the await it would no longer show who asked.
    const stack = modelFromUrl(url) ? new Error().stack : undefined;
    const res = await original(input, init);
    if (!supabaseUrl || !key || !res.ok || !stack) return res;
    try {
      const logged = res.clone().json().then((body) => {
        const row = usageRow(url, stack, body);
        return row ? record(row) : undefined;
      }).catch((e) => console.warn("[ai-usage] not recorded:", e instanceof Error ? e.message : e));
      g.EdgeRuntime?.waitUntil?.(logged);
    } catch (e) {
      console.warn("[ai-usage] not recorded:", e instanceof Error ? e.message : e);
    }
    return res;
  };
}

installAiUsageLogging();
