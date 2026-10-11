// Shared Veem API helper (OAuth 2.0 client credentials). Credentials never leave the edge runtime.
// Secrets: VEEM_CLIENT_ID, VEEM_CLIENT_SECRET; VEEM_ENVIRONMENT = sandbox (default) | production; VEEM_BASE_URL overrides the host.

export function veemConfigured(): boolean {
  return Boolean(Deno.env.get("VEEM_CLIENT_ID") && Deno.env.get("VEEM_CLIENT_SECRET"));
}

export function veemBaseUrl(): string {
  const override = Deno.env.get("VEEM_BASE_URL");
  if (override) return override.replace(/\/+$/, "");
  return (Deno.env.get("VEEM_ENVIRONMENT") || "sandbox").toLowerCase() === "production" ? "https://api.veem.com" : "https://sandbox-api.veem.com";
}

let cached: { token: string; expiresAt: number } | null = null;

async function veemToken(force = false): Promise<string> {
  if (!force && cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
  const id = Deno.env.get("VEEM_CLIENT_ID"), secret = Deno.env.get("VEEM_CLIENT_SECRET");
  if (!id || !secret) throw new Error("Veem is not connected: VEEM_CLIENT_ID and VEEM_CLIENT_SECRET are not set.");
  const res = await fetch(`${veemBaseUrl()}/oauth/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${btoa(`${id}:${secret}`)}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", scope: "all" }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.access_token) throw new Error(`Veem sign-in failed [${res.status}]: ${String(data?.error_description ?? data?.error ?? "no token returned").slice(0, 200)}`);
  cached = { token: data.access_token as string, expiresAt: Date.now() + Math.min(Number(data.expires_in) || 3600, 86_400) * 1000 };
  return cached.token;
}

export interface VeemResult<T = any> { ok: boolean; status: number; data: T }

/** One call to the Veem API, with a unique X-Request-Id (Veem answers 409 to a repeat). A 401 gets one retry on a fresh token. */
export async function veem<T = any>(path: string, init: { method?: string; body?: unknown } = {}): Promise<VeemResult<T>> {
  const call = async (token: string) => {
    const res = await fetch(`${veemBaseUrl()}${path}`, {
      method: init.method || "GET",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "X-Request-Id": crypto.randomUUID() },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    const text = await res.text();
    let data: any = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
    return { res, data, text };
  };
  let r = await call(await veemToken());
  if (r.res.status === 401) r = await call(await veemToken(true));
  if (!r.res.ok) console.error(`Veem ${init.method || "GET"} ${path} failed [${r.res.status}]: ${r.text.slice(0, 800)}`);
  return { ok: r.res.ok, status: r.res.status, data: r.data };
}

export function veemErrorMessage(data: any): string {
  const m = data?.message || data?.error || data?.raw;
  return m ? `Veem: ${String(m).slice(0, 300)}` : "Veem rejected the request.";
}
