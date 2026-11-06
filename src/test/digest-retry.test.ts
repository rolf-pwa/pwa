import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { MAX_DIGEST_ATTEMPTS, afterFailure, backoffMinutes, history, isDue } from "../../supabase/functions/_shared/digest-retry";
import { findOrMintMagicLink } from "../../supabase/functions/_shared/portal-magic-link";

const NOW = Date.parse("2026-11-06T12:00:00Z");
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();

describe("how long the digest waits after a failed send", () => {
  it("grows, and is nothing before the first try", () => {
    expect([0, 1, 2, 3, 4, 5, 6, 9].map(backoffMinutes)).toEqual([0, 10, 30, 90, 240, 360, 360, 360]);
  });
  it("sends a row that has never been tried, and one whose wait has passed, and holds one still waiting", () => {
    expect(isDue([{ attempts: 0 }], NOW)).toBe(true);
    expect(isDue([{}], NOW)).toBe(true);
    expect(isDue([{ attempts: 1, last_attempt_at: ago(11) }], NOW)).toBe(true);
    expect(isDue([{ attempts: 1, last_attempt_at: ago(5) }], NOW)).toBe(false);
    expect(isDue([{ attempts: 3, last_attempt_at: ago(60) }], NOW)).toBe(false);
    expect(isDue([{ attempts: 3, last_attempt_at: ago(95) }], NOW)).toBe(true);
  });
  it("judges a recipient by its most-tried rows, so a new row added to a stuck recipient does not restart the clock", () => {
    const rows = [{ attempts: 4, last_attempt_at: ago(30) }, { attempts: 0, last_attempt_at: null }];
    expect(history(rows)).toEqual({ attempts: 4, lastAttemptAt: NOW - 30 * 60_000 });
    expect(isDue(rows, NOW)).toBe(false);
  });
  it("gives up after the sixth failed try, and says so", () => {
    expect(MAX_DIGEST_ATTEMPTS).toBe(6);
    expect(afterFailure([{ attempts: 0 }])).toEqual({ attempts: 1, giveUp: false });
    expect(afterFailure([{ attempts: 4 }])).toEqual({ attempts: 5, giveUp: false });
    expect(afterFailure([{ attempts: 5 }, { attempts: 1 }])).toEqual({ attempts: 6, giveUp: true });
  });
});

function fakeDb(existing: { token: string; expires_at: string } | null) {
  const calls: string[] = [];
  const q: Record<string, unknown> = {};
  for (const m of ["select", "eq", "is", "gt", "order", "limit"]) q[m] = (...a: unknown[]) => { calls.push(`${m}:${a.join(",")}`); return q; };
  q.maybeSingle = async () => ({ data: existing });
  q.insert = (row: unknown) => { calls.push("insert:" + JSON.stringify(row)); return { select: () => ({ single: async () => ({ data: { token: "new-token" }, error: null }) }) }; };
  return { db: { from: () => q }, calls };
}

describe("a link that is still good is reused, not minted again", () => {
  it("reuses an unused link with enough time left", async () => {
    const { db, calls } = fakeDb({ token: "old-token", expires_at: "2026-11-06T13:00:00Z" });
    const r = await findOrMintMagicLink(db, { contactId: "c1", targetHash: "tasks" });
    expect(r).toMatchObject({ token: "old-token", url: "https://app.prosperwise.ca/portal/old-token#tasks" });
    expect(calls.some((c) => c.startsWith("insert"))).toBe(false);
    expect(calls.some((c) => c.startsWith("is:used_at"))).toBe(true);
    expect(calls).toContain("eq:revoked,false");
    expect(calls).toContain("eq:target_hash,tasks");
  });
  it("mints a new one when none is left", async () => {
    const { db, calls } = fakeDb(null);
    const r = await findOrMintMagicLink(db, { contactId: "c1", targetHash: "tasks" });
    expect(r?.token).toBe("new-token");
    expect(calls.some((c) => c.startsWith("insert"))).toBe(true);
  });
});

describe("the digest and the migration", () => {
  const fn = readFileSync("supabase/functions/process-email-digest/index.ts", "utf8");
  it("skips a recipient still waiting, counts a failed send, gives up and tells the advisor, and reuses links", () => {
    expect(fn).toContain("if (!isDue(items, Date.now())) continue;");
    expect(fn).toContain(".is(\"failed_at\", null)");
    expect(fn).toContain("const next = afterFailure(items);");
    expect(fn).toContain('source_type: "email_digest_failed"');
    expect(fn).toContain("findOrMintMagicLink(supabase");
    expect(fn).not.toMatch(/\bmintMagicLink\(supabase/);
  });
  it("adds the attempt columns, purges expired tokens now and weekly, and gives stale rows one last try", () => {
    const sql = readFileSync("supabase/migrations/20270118120000_digest_retry_and_token_cleanup.sql", "utf8");
    for (const c of ["attempts integer NOT NULL DEFAULT 0", "last_attempt_at timestamptz", "failed_at timestamptz"]) expect(sql).toContain(c);
    expect(sql).toContain("DELETE FROM public.portal_tokens WHERE expires_at < now() - interval '30 days'");
    expect(sql).toContain("SELECT cron.schedule('portal-token-cleanup'");
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.purge_expired_portal_tokens() FROM PUBLIC, anon, authenticated");
  });
});
