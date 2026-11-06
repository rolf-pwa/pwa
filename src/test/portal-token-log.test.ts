import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { clientIpFrom, logTokenUse, tokenFingerprint, userAgentFrom } from "../../supabase/functions/_shared/portal-token-log";

const headers = (o: Record<string, string>) => ({ get: (n: string) => o[n.toLowerCase()] ?? null });

describe("portal token use record", () => {
  it("takes the first forwarded address and a trimmed browser string", () => {
    expect(clientIpFrom(headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }))).toBe("203.0.113.7");
    expect(clientIpFrom(headers({}))).toBeNull();
    expect(userAgentFrom(headers({ "user-agent": "  Mozilla/5.0 test  " }))).toBe("Mozilla/5.0 test");
    expect(userAgentFrom(headers({ "user-agent": "x".repeat(1000) }))!.length).toBe(300);
    expect(userAgentFrom(headers({}))).toBeNull();
  });
  it("keeps only a short fingerprint of a presented token, never the token", async () => {
    const f = await tokenFingerprint("secret-token-value");
    expect(f).toMatch(/^[0-9a-f]{12}$/);
    expect(f).toBe(await tokenFingerprint("secret-token-value"));
    expect(f).not.toBe(await tokenFingerprint("another"));
  });
  it("never lets a failed write stop the request", async () => {
    const row = { token_id: null, contact_id: null, purpose: null, outcome: "invalid" as const, ip: null, user_agent: null, token_fingerprint: "abc" };
    await expect(logTokenUse({ from: () => ({ insert: async () => ({ error: { message: "boom" } }) }) }, row)).resolves.toBeUndefined();
    await expect(logTokenUse({ from: () => { throw new Error("down"); } }, row)).resolves.toBeUndefined();
    const insert = vi.fn(async () => ({ error: null }));
    await logTokenUse({ from: () => ({ insert }) }, row);
    expect(insert).toHaveBeenCalledWith(row);
  });
  it("is wired into the portal's token check for every outcome, and the table is staff-only with its own grants", () => {
    const fn = readFileSync("supabase/functions/portal-validate/index.ts", "utf8");
    for (const o of ['"invalid"', '"expired"', '"already_used"', '"first_use"']) expect(fn).toContain(o);
    expect(fn).toContain("first_used_user_agent: clientUa");
    const sql = readFileSync("supabase/migrations/20270119130000_portal_token_use_log.sql", "utf8");
    expect(sql).toContain("GRANT ALL ON public.portal_token_uses TO service_role");
    expect(sql).toContain("USING (public.is_staff())");
    expect(sql).toContain("ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain("portal_token_uses WHERE created_at < now() - interval '400 days'");
  });
});
