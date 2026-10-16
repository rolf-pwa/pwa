// What the "Scan Vault for Updates" button tells staff when the household is on the V2 engine.
// A V2 scan writes nothing to records: each file's extraction is held for an advisor to approve in
// Glass-Box Review, so the V1 wording ("N accounts updated") would be wrong and misleading.

export interface ScanResponseLike {
  v2HeldForReview?: number;
  v2AutoApproved?: number;
}

/** True only when the scan ran on the V2 path and held at least one extraction for review. */
export function isHeldForReview(data: ScanResponseLike | null | undefined): boolean {
  return typeof data?.v2HeldForReview === "number" && data.v2HeldForReview > 0;
}

/**
 * What a V2 scan tells staff: items Stage 2 fully verified are approved automatically, the rest wait in Glass-Box Review.
 * Null when the response is not from a V2 scan that read anything.
 */
export function v2ScanOutcome(data: ScanResponseLike | null | undefined): { message: string; needsReview: boolean } | null {
  const approved = typeof data?.v2AutoApproved === "number" ? data.v2AutoApproved : 0;
  const held = typeof data?.v2HeldForReview === "number" ? data.v2HeldForReview : 0;
  if (!approved && !held) return null;
  const doc = (n: number) => `${n} document${n === 1 ? "" : "s"}`;
  if (!held) return { message: `Vault scan complete: ${doc(approved)} verified and approved automatically. Nothing needs your review.`, needsReview: false };
  if (!approved) return { message: heldForReviewMessage(held), needsReview: true };
  return { message: `Vault scan complete: ${doc(approved)} approved automatically; ${held} need${held === 1 ? "s" : ""} your review.`, needsReview: true };
}

export function heldForReviewMessage(held: number): string {
  return `Vault scan complete: ${held} document${held === 1 ? "" : "s"} held for your review. No records have been changed yet.`;
}
