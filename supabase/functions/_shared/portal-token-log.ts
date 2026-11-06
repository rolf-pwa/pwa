// portal-token-log.ts: a record of every attempt to use a portal link or session token. Before this, only the first use of a sign-in link was
// noted (its IP, never the browser), a staff preview or client session token left nothing, and a failed attempt left nothing.
// The token itself is never stored: a rejected attempt keeps only a short fingerprint of what was presented.

// deno-lint-ignore-file no-explicit-any
export type TokenOutcome = "ok" | "first_use" | "invalid" | "expired" | "already_used";

export interface TokenUseRow {
  token_id: string | null;
  contact_id: string | null;
  purpose: string | null;
  outcome: TokenOutcome;
  ip: string | null;
  user_agent: string | null;
  token_fingerprint: string | null;
}

/** The first address in x-forwarded-for, or null. */
export function clientIpFrom(h: { get(name: string): string | null }): string | null {
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
}

/** The browser string, trimmed so a hostile header cannot fill the table. */
export function userAgentFrom(h: { get(name: string): string | null }): string | null {
  const ua = h.get("user-agent")?.trim();
  return ua ? ua.slice(0, 300) : null;
}

/** The first 12 hex characters of a SHA-256 of the presented token: enough to tell repeats apart, useless for signing in. */
export async function tokenFingerprint(token: string): Promise<string> {
  const buf = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("").slice(0, 12);
}

/** Best effort: a failure to write the record never stops the person getting in or being turned away. */
export async function logTokenUse(db: any, row: TokenUseRow): Promise<void> {
  try {
    const { error } = await db.from("portal_token_uses").insert(row);
    if (error) console.error("[portal-token-log] insert failed:", error.message);
  } catch (e) {
    console.error("[portal-token-log] insert threw:", e instanceof Error ? e.message : e);
  }
}
