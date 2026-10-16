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

import { v2ScanOutcome } from "../modules/crm/lib/vaultScanMessage";
describe("what a V2 scan says now that verified items are approved automatically", () => {
  it("says nothing needs review when everything verified", () => {
    expect(v2ScanOutcome({ v2AutoApproved: 3, v2HeldForReview: 0 })).toEqual({ message: "Vault scan complete: 3 documents verified and approved automatically. Nothing needs your review.", needsReview: false });
  });
  it("splits approved from needing review", () => {
    expect(v2ScanOutcome({ v2AutoApproved: 2, v2HeldForReview: 1 })).toEqual({ message: "Vault scan complete: 2 documents approved automatically; 1 needs your review.", needsReview: true });
  });
  it("keeps the held-for-review wording when nothing was approved, and is null when nothing was read", () => {
    expect(v2ScanOutcome({ v2HeldForReview: 2 })?.needsReview).toBe(true);
    expect(v2ScanOutcome({ v2AutoApproved: 0, v2HeldForReview: 0 })).toBeNull();
    expect(v2ScanOutcome(null)).toBeNull();
  });
});
