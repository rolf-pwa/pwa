import { describe, it, expect, vi } from "vitest";
import { withRegionPin } from "@/shared/lib/region-pin";

const BASE = "https://abc.supabase.co";
const run = async (url: string, init?: RequestInit) => {
  const native = vi.fn(async () => new Response("ok"));
  await withRegionPin(native as unknown as typeof fetch, BASE)(url, init);
  const [, passed] = native.mock.calls[0] as unknown as [string, RequestInit];
  return new Headers(passed?.headers);
};

describe("region pin", () => {
  it("adds x-region to this project's functions and keeps existing headers", async () => {
    const h = await run(`${BASE}/functions/v1/portal-validate`, { headers: { Authorization: "Bearer t", "Content-Type": "application/json" } });
    expect(h.get("x-region")).toBe("ca-central-1");
    expect(h.get("authorization")).toBe("Bearer t");
  });
  it("pins calls that pass no headers", async () => {
    expect((await run(`${BASE}/functions/v1/vault-service`, { method: "POST" })).get("x-region")).toBe("ca-central-1");
  });
  it("leaves other Supabase endpoints and other hosts alone", async () => {
    expect((await run(`${BASE}/rest/v1/contacts`)).get("x-region")).toBeNull();
    expect((await run("https://example.com/functions/v1/x")).get("x-region")).toBeNull();
  });
  it("does not override an explicit region", async () => {
    expect((await run(`${BASE}/functions/v1/x`, { headers: { "x-region": "us-east-1" } })).get("x-region")).toBe("us-east-1");
  });
});
