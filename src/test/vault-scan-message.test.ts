import { describe, expect, it } from "vitest";
import { heldForReviewMessage, isHeldForReview } from "../modules/crm/lib/vaultScanMessage";

describe("V2 vault scan completion message", () => {
  it("recognises a V2 scan that held extractions, and nothing else", () => {
    expect(isHeldForReview({ v2HeldForReview: 2 })).toBe(true);
    expect(isHeldForReview({ v2HeldForReview: 0 })).toBe(false); // nothing held: fall back to the normal messages
    expect(isHeldForReview({})).toBe(false);                      // a V1 response has no such field
    expect(isHeldForReview(null)).toBe(false);
    expect(isHeldForReview(undefined)).toBe(false);
  });
  it("says documents were held and that no records changed (singular and plural)", () => {
    expect(heldForReviewMessage(1)).toBe("Vault scan complete: 1 document held for your review. No records have been changed yet.");
    expect(heldForReviewMessage(3)).toBe("Vault scan complete: 3 documents held for your review. No records have been changed yet.");
  });
  it("never uses the V1 wording that would mislead for a V2 scan", () => {
    expect(heldForReviewMessage(2)).not.toMatch(/updated|no changes|matched/i);
  });
});
