// share-link-expiry.ts: a document share link always expires, in 30 days at the most. Pure; no I/O.
// Until now a link made with "Copy Vault link" never expired: 14 of them were live, 12 allowing upload and download, and 11 had never been opened.

export const SHARE_LINK_MAX_DAYS = 30;
const DAY = 86_400_000;

/** The expiry for a new share link: the requested time if it is in the future and within 30 days, else 30 days from now. Always an ISO string. */
export function shareLinkExpiry(requested: unknown, now: number = Date.now()): string {
  const limit = now + SHARE_LINK_MAX_DAYS * DAY;
  const asked = typeof requested === "string" ? Date.parse(requested) : NaN;
  return new Date(Number.isFinite(asked) && asked > now ? Math.min(asked, limit) : limit).toISOString();
}

/** "February 3, 2027": how an expiry reads in an email. Pacific, like the rest of the app. */
export function expiryText(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Vancouver", year: "numeric", month: "long", day: "numeric" });
}
