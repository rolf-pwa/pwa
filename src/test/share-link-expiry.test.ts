import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { SHARE_LINK_MAX_DAYS, expiryText, shareLinkExpiry } from "../../supabase/functions/_shared/share-link-expiry";

const NOW = Date.parse("2026-11-06T18:00:00Z");
const days = (n: number) => new Date(NOW + n * 86_400_000).toISOString();

describe("a share link always expires, in 30 days at the most", () => {
  it("defaults to 30 days when no expiry is asked for", () => {
    expect(SHARE_LINK_MAX_DAYS).toBe(30);
    for (const asked of [undefined, null, "", "never", 0]) expect(shareLinkExpiry(asked, NOW), String(asked)).toBe(days(30));
  });
  it("keeps a shorter expiry that was asked for", () => {
    expect(shareLinkExpiry(days(7), NOW)).toBe(days(7));
    expect(shareLinkExpiry(days(30), NOW)).toBe(days(30));
  });
  it("cuts a longer one back to 30 days, and does not make a link that is already over", () => {
    expect(shareLinkExpiry(days(365), NOW)).toBe(days(30));
    expect(shareLinkExpiry("2099-01-01T00:00:00Z", NOW)).toBe(days(30));
    expect(shareLinkExpiry(days(-3), NOW)).toBe(days(30));
  });
  it("reads as a date in the email, in Pacific time", () => {
    expect(expiryText("2026-12-06T18:00:00Z")).toBe("December 6, 2026");
    expect(expiryText("2026-12-07T03:00:00Z")).toBe("December 6, 2026");
  });
});

describe("the vault function", () => {
  const src = readFileSync("supabase/functions/vault-service/index.ts", "utf8");
  it("applies it to every new share link and says so in the email", () => {
    const start = src.indexOf('action === "createShareLink"');
    const block = src.slice(start, src.indexOf("action ===", start + 40));
    expect(block).toContain("expires_at: shareLinkExpiry(expires_at),");
    expect(block).not.toContain("expires_at ?? null");
    expect(src).toContain("This link expires on ${expiryText(link.expires_at)}");
  });
  it("tells the advisor in the app when a link is copied", () => {
    expect(readFileSync("src/modules/crm/pages/Vault.tsx", "utf8")).toContain("It expires in 30 days.");
  });
});
