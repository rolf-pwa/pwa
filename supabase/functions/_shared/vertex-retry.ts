// Pure (no Deno/env deps) so it can be unit-tested in src/test.

const RETRYABLE_STATUS = new Set([429, 503]);
const RETRY_DELAYS_MS = [1500, 4000, 9000];

/**
 * fetch() with retry-and-backoff for Vertex's transient 429 RESOURCE_EXHAUSTED
 * and 503 responses. generateContent is stateless, so replaying it is safe.
 * Live A/B runs on 5MB PDFs hit 429 on both 2.5 and 3.5 Flash (including
 * ~1 in 3 sequential 2.5 calls), and until now every call site failed on the
 * first one. Honors Retry-After (capped) when Vertex sends it. Callers with a
 * tight latency budget (e.g. Georgia's 8s model timeout) pass a smaller
 * maxRetries so retries can't outlive their own deadline.
 */
export async function fetchWithVertexRetry(
  url: string,
  init: RequestInit,
  opts: { maxRetries?: number } = {},
): Promise<Response> {
  let res = await fetch(url, init);
  for (const baseDelay of RETRY_DELAYS_MS.slice(0, opts.maxRetries ?? RETRY_DELAYS_MS.length)) {
    if (!RETRYABLE_STATUS.has(res.status)) return res;
    const retryAfter = Number(res.headers.get("retry-after"));
    const wait = Math.min(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : baseDelay, 15000);
    await res.body?.cancel();
    await new Promise((r) => setTimeout(r, wait + Math.floor(Math.random() * 500)));
    res = await fetch(url, init);
  }
  return res;
}

/** Whether Vertex answered "busy" (rate limited or temporarily unavailable). */
export const isVertexBusy = (status: number): boolean => RETRYABLE_STATUS.has(status);

/**
 * Posts with the primary model; if it is still busy after its own retries, once more with the fallback model (the same region, so client data
 * stays in Canada). Returns whichever response came last. `post` makes one attempt (with its retries) for the given model.
 */
export async function withModelFallback(post: (model: string) => Promise<Response>, model: string, fallback?: string | null): Promise<Response> {
  const res = await post(model);
  if (!isVertexBusy(res.status) || !fallback || fallback === model) return res;
  console.warn(`[vertex] ${model} is busy (${res.status}); trying ${fallback}`);
  await res.body?.cancel();
  return await post(fallback);
}

export const VERTEX_BUSY_MESSAGE = "Georgia's AI service is busy right now (Google is limiting requests). Please try again in a minute.";
