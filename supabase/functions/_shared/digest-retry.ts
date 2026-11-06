// digest-retry.ts: how often the email digest retries a recipient it could not reach, and when it gives up. Pure; no I/O.
// Before this, a digest that failed to send was simply tried again at the next run, every ten minutes for ever, and each try minted a fresh sign-in
// link: one stuck recipient produced about 150 portal tokens a day for months.

export const MAX_DIGEST_ATTEMPTS = 6;
const MINUTE = 60_000;
/** Minutes to wait after the nth failed attempt: 10, 30, 90, 240, then 360. */
const WAITS = [10, 30, 90, 240, 360];

export const backoffMinutes = (attempts: number): number => (attempts <= 0 ? 0 : WAITS[Math.min(attempts, WAITS.length) - 1]);

export interface DigestRow { attempts?: number | null; last_attempt_at?: string | null }

/** What a recipient's waiting rows have been through: the most attempts and the latest try among them. */
export function history(rows: DigestRow[]): { attempts: number; lastAttemptAt: number | null } {
  const attempts = Math.max(0, ...rows.map((r) => r.attempts ?? 0));
  const times = rows.map((r) => (r.last_attempt_at ? Date.parse(r.last_attempt_at) : NaN)).filter((t) => Number.isFinite(t));
  return { attempts, lastAttemptAt: times.length ? Math.max(...times) : null };
}

/** True when the rows have never been tried, or their wait since the last failed try has passed. */
export function isDue(rows: DigestRow[], now: number): boolean {
  const h = history(rows);
  if (h.attempts === 0 || h.lastAttemptAt === null) return true;
  return now - h.lastAttemptAt >= backoffMinutes(h.attempts) * MINUTE;
}

/** After one more failed try: the new attempt count, and whether to stop trying and tell the advisor. */
export function afterFailure(rows: DigestRow[]): { attempts: number; giveUp: boolean } {
  const attempts = history(rows).attempts + 1;
  return { attempts, giveUp: attempts >= MAX_DIGEST_ATTEMPTS };
}
