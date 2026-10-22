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

import { describeAuthorizedItem } from "../../supabase/functions/_shared/portfolio-review-client";
import { readFileSync } from "node:fs";

describe("seeing exactly what was authorized", () => {
  it("describes an authorized item with the exact amount, and flags a taxable switch", () => {
    const sw: any = { kind: "switch", id: "switch:a1", label: "RRSP …5554", owner: "Claudine Matlo", direction: "to_income", amount: 5300, exactAmount: 5316, taxable: false, estGain: null };
    expect(describeAuthorizedItem(sw)).toBe("RRSP …5554 (Claudine Matlo): switch $5,316 from equity into income funds");
    const reset: any = { kind: "reset", id: "reset:a1", label: "RRSP …5554", owner: "Claudine Matlo", currentGuarantee: 43814, newGuarantee: 50629, lift: 6815 };
    expect(describeAuthorizedItem(reset)).toContain("reset the death benefit guarantee from $43,814 to $50,629");
    expect(describeAuthorizedItem({ ...sw, taxable: true, estGain: 1200 })).toContain("[TAXABLE");
  });
  it("sends Rolf's task to the authorizations on the pack, without copying details into it", () => {
    const f = readFileSync("supabase/functions/portal-rebalance/index.ts", "utf8");
    expect(f).toContain("portfolio-review#authorizations");
    expect(f).toContain("Exactly what they authorized, by whom and when");
    expect(f).not.toContain("publishedInstructions");
  });
  it("loads the authorizations for the latest published rebalancing, even after it is done", () => {
    const f = readFileSync("supabase/functions/review-agent-admin/index.ts", "utf8");
    expect(f).toContain("authorizations,");
    expect(f).toMatch(/not\("published_at", "is", null\)[\s\S]{0,120}order\("published_at"/);
  });
});

describe("the portfolio review page", () => {
  const page = readFileSync("src/modules/crm/pages/PortfolioReview.tsx", "utf8");
  it("puts the Investor Profile first, then the authorizations, then what the client sees, and scans the Vault from the pack", () => {
    const profile = page.indexOf("Investor Profile</CardTitle>");
    const auth = page.indexOf("<RebalanceAuthorizations");
    const publish = page.indexOf("<PublishToClient");
    expect(profile).toBeGreaterThan(-1);
    expect(profile).toBeLessThan(auth);
    expect(auth).toBeLessThan(publish);
    expect(page).toContain("<VaultScanButton householdId={data.household.id} onDone={load} />");
    expect(page).toContain('window.location.hash === "#authorizations"');
  });
});
