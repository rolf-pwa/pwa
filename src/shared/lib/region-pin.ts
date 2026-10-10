// Supabase Edge Functions run at the location nearest the caller unless told otherwise, which for us is usually
// the US. Client data is handled by these functions, so every browser request to them is pinned to the Canada
// Central region (the same region as the database) with the x-region header. Every function lists x-region in its
// CORS allowed headers. Server-to-server calls and the scheduled jobs set the same header themselves.
export const FUNCTIONS_REGION = "ca-central-1";

const isOurFunction = (url: string, base: string | undefined) =>
  !!base && url.startsWith(`${base.replace(/\/+$/, "")}/functions/v1/`);

/** Wraps a fetch so requests to this project's Edge Functions carry the region header. */
export function withRegionPin(nativeFetch: typeof fetch, base: string | undefined = import.meta.env.VITE_SUPABASE_URL): typeof fetch {
  return ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!isOurFunction(url, base)) return nativeFetch(input, init);
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    if (!headers.has("x-region")) headers.set("x-region", FUNCTIONS_REGION);
    return nativeFetch(input instanceof Request && !init ? new Request(input, { headers }) : input, { ...init, headers });
  }) as typeof fetch;
}

// Installed as a side effect, before the Supabase client is created (it keeps a reference to fetch).
if (typeof window !== "undefined" && typeof window.fetch === "function") {
  window.fetch = withRegionPin(window.fetch.bind(window));
}
