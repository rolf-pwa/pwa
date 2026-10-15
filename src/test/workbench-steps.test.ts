import { describe, it, expect } from "vitest";
import { decideWorkbench, windowState, STEP_ORDER, type WorkbenchFacts } from "@/modules/crm/lib/workbenchSteps";

const facts = (over: Partial<WorkbenchFacts> = {}): WorkbenchFacts => ({ tier: "tier_2a", hasRatifiedCharter: false, obligations: [], publishedReview: false, ...over });
const ob = (kind: string, start: string, end: string, status = "open") => ({ kind, window_start: start, window_end: end, status });
const decide = (f: WorkbenchFacts | null, today: string, extra: Partial<{ onboardingComplete: boolean; charterStarted: boolean }> = {}) => decideWorkbench({ facts: f, onboardingComplete: true, charterStarted: false, today, ...extra });

describe("which Workbench steps a household sees", () => {
  it("shows the Portfolio Review to Tier 2A only from 30 days before its window until it closes", () => {
    const f = facts({ obligations: [ob("annual_review", "2027-04-01", "2027-06-30")] });
    expect(decide(f, "2027-02-15").portfolio_review.show).toBe(false);
    expect(decide(f, "2027-02-15").portfolio_review.reason).toBe("Next review window opens Apr 1");
    expect(decide(f, "2027-03-05").portfolio_review.show).toBe(true);
    expect(decide(f, "2027-06-30").portfolio_review.show).toBe(true);
    expect(decide(f, "2027-07-02").portfolio_review.show).toBe(false);
  });
  it("hides it once the review has been held, unless a published review is still open to the client", () => {
    const held = facts({ obligations: [ob("annual_review", "2027-04-01", "2027-06-30", "held")] });
    expect(decide(held, "2027-05-10").portfolio_review.show).toBe(false);
    expect(decide({ ...held, publishedReview: true }, "2027-05-10").portfolio_review.show).toBe(true);
  });
  it("never shows it for Tier 3, 4 or a household with no tier", () => {
    const o = [ob("annual_review", "2027-04-01", "2027-06-30")];
    expect(decide(facts({ tier: "tier_3", obligations: o }), "2027-05-01").portfolio_review).toEqual({ show: false, reason: "Not part of this tier" });
    expect(decide(facts({ tier: null, obligations: o }), "2027-05-01").portfolio_review.reason).toBe("No service tier");
  });
  it("counts Tier 1's Q3 rebalancing as a portfolio window", () => {
    const f = facts({ tier: "tier_1", obligations: [ob("rebalancing", "2027-07-01", "2027-09-30")] });
    expect(decide(f, "2027-08-01").portfolio_review.show).toBe(true);
  });
  it("shows the Sovereignty Review and Governance Audit to Tier 2B and up, or a chartered household, in their windows", () => {
    const o = [ob("sovereignty_review", "2027-04-01", "2027-06-30")];
    expect(decide(facts({ tier: "tier_3", obligations: o }), "2027-05-01").sovereignty_review.show).toBe(true);
    expect(decide(facts({ tier: "tier_3", obligations: o }), "2027-05-01").governance_audit.show).toBe(true);
    expect(decide(facts({ tier: "tier_3", obligations: o }), "2027-08-20").sovereignty_review.show).toBe(false);
    expect(decide(facts({ tier: "tier_2a", hasRatifiedCharter: true, obligations: o }), "2027-05-01").sovereignty_review.show).toBe(true);
    expect(decide(facts({ tier: "tier_1", obligations: o }), "2027-05-01").sovereignty_review).toEqual({ show: false, reason: "Needs a Charter or Tier 2B and above" });
  });
  it("shows Charter and Causal AI to Tier 2B and up, a chartered household, or one with a Charter started", () => {
    expect(decide(facts({ tier: "tier_2b" }), "2027-05-01").charter.show).toBe(true);
    expect(decide(facts({ tier: "tier_2a" }), "2027-05-01").causal_ai.show).toBe(false);
    expect(decide(facts({ tier: "tier_2a" }), "2027-05-01", { charterStarted: true }).charter.show).toBe(true);
    expect(decide(facts({ tier: "tier_1", hasRatifiedCharter: true }), "2027-05-01").causal_ai.show).toBe(true);
  });
  it("shows the Map and Guided Intake only while onboarding is not complete", () => {
    expect(decide(facts(), "2027-05-01", { onboardingComplete: false }).stabilization_map.show).toBe(true);
    expect(decide(facts(), "2027-05-01", { onboardingComplete: false }).guided_intake.show).toBe(true);
    expect(decide(facts(), "2027-05-01").stabilization_map).toEqual({ show: false, reason: "Onboarding is complete" });
  });
  it("hides nothing by tier or window when the facts could not be loaded", () => {
    const d = decide(null, "2027-05-01");
    expect(STEP_ORDER.filter((k) => !["guided_intake", "stabilization_map"].includes(k)).every((k) => d[k].show)).toBe(true);
  });
  it("finds the next window and ignores cancelled and held ones", () => {
    expect(windowState([ob("annual_review", "2027-10-01", "2027-12-31", "cancelled"), ob("annual_review", "2027-04-01", "2027-06-30")], ["annual_review"], "2027-01-01")).toEqual({ open: false, next: "2027-04-01" });
  });
});
