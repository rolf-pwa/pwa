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

import { publishedInstructions } from "../../supabase/functions/_shared/portfolio-review-client";
import { readFileSync } from "node:fs";

describe("instructions to carry out a rebalancing, from what the client was shown", () => {
  const view: any = {
    note: "Moving some of your RRSP into income funds.",
    rebalance: { rows: [{ label: "RRSP …5554", owner: "Claudine Matlo", direction: "to_income", amount: 5300, taxable: false }, { label: "Cash …1234", owner: "Don", direction: "to_equity", amount: 2000, taxable: true }], hasTaxable: true },
    reset: { rows: [{ name: "RRSP", owner: "Claudine Matlo", last4: "5554", fundValue: 50000, currentGuarantee: 43814, newGuarantee: 50629, lift: 6815 }], totalLift: 6815 },
    funds: { commentary: [], modelLabel: "Balanced", modelAsOf: "2026-09-30", heldInModelPct: 80, rows: [{ name: "IA Clarington Bond", modelPct: 30, heldPct: 22.4, inModel: true }, { name: "Old Fund", modelPct: null, heldPct: 5, inModel: false }] },
  };
  it("lists the note, the switches, the resets and the fund gaps in plain text", () => {
    const text = publishedInstructions(view).join("\n");
    expect(text).toContain("What you told the client:");
    expect(text).toContain("Moving some of your RRSP into income funds.");
    expect(text).toContain("RRSP …5554 (Claudine Matlo): switch about $5,300 from equity into income funds");
    expect(text).toContain("Cash …1234 (Don): switch about $2,000 from income into equity funds [TAXABLE]");
    expect(text).toContain("guarantee from $43,814 to $50,629");
    expect(text).toContain("Funds held against the Balanced model");
    expect(text).toContain("IA Clarington Bond: held 22.4%, model 30%");
    expect(text).toContain("Old Fund: held 5%, model not in the model");
  });
  it("gives just the note when no page was published, and nothing when there is nothing", () => {
    expect(publishedInstructions(null, { note: "Hello" }).join("\n")).toContain("Hello");
    expect(publishedInstructions(null)).toEqual([]);
  });
  it("is added to both kinds of task Rolf gets when a client authorizes", () => {
    const f = readFileSync("supabase/functions/portal-rebalance/index.ts", "utf8");
    expect(f).toContain("publishedInstructions(");
    expect(f).toMatch(/\$\{plan\.description\}\$\{detail/);
    expect(f).toContain("What they were shown:");
  });
});

describe("the portfolio review page", () => {
  const page = readFileSync("src/modules/crm/pages/PortfolioReview.tsx", "utf8");
  it("puts the Investor Profile above what the client sees, and can scan the Vault from the pack", () => {
    expect(page.indexOf("Investor Profile</CardTitle>")).toBeGreaterThan(-1);
    expect(page.indexOf("Investor Profile</CardTitle>")).toBeLessThan(page.indexOf("<PublishToClient"));
    expect(page).toContain("<VaultScanButton householdId={data.household.id} onDone={load} />");
  });
});
