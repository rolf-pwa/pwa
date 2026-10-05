// What the "Scan Vault for Updates" button tells staff when the household is on the V2 engine.
// A V2 scan writes nothing to records: each file's extraction is held for an advisor to approve in
// Glass-Box Review, so the V1 wording ("N accounts updated") would be wrong and misleading.

export interface ScanResponseLike {
  v2HeldForReview?: number;
}

/** True only when the scan ran on the V2 path and held at least one extraction for review. */
export function isHeldForReview(data: ScanResponseLike | null | undefined): boolean {
  return typeof data?.v2HeldForReview === "number" && data.v2HeldForReview > 0;
}

export function heldForReviewMessage(held: number): string {
  return `Vault scan complete: ${held} document${held === 1 ? "" : "s"} held for your review. No records have been changed yet.`;
}
