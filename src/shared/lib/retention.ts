// retention.ts: the 7-year rule. Client records are kept for 7 years after the advisory relationship ends. A household whose relationship has ended is a "former
// client": it leaves the main CRM lists for the Former clients page, where staff can still open it. The database refuses to permanently delete it until the 7 years
// are over (see the retention_delete_guard migration). Pure.
export const RETENTION_YEARS = 7;

/** True when the household's advisory relationship has ended. */
export const isFormer = (h: { relationship_ended_at?: string | null } | null | undefined): boolean => !!h?.relationship_ended_at;

/** The day the 7 years are over. */
export function keepUntil(endedAt: string | Date): Date {
  const d = new Date(endedAt);
  d.setUTCFullYear(d.getUTCFullYear() + RETENTION_YEARS);
  return d;
}

/** Whether the 7 years are over, so the records can be reviewed for destruction (never automatic). */
export const retentionOver = (endedAt: string | Date, now = new Date()): boolean => keepUntil(endedAt).getTime() <= now.getTime();

export const keepUntilLabel = (endedAt: string | Date): string => keepUntil(endedAt).toLocaleDateString("en-CA", { month: "long", year: "numeric", timeZone: "UTC" });
