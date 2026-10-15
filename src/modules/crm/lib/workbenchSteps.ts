// workbenchSteps.ts: which steps of the household AI Workbench apply to a household right now. Pure (no I/O) so it can be unit-tested.
//
// Rolf's rules: show a step only when it is useful, by the household's client journey, tier and review window. Anything that does not apply
// moves to "More tools" with a one-line reason, so nothing is ever unreachable.

export type StepKey = "stabilization_map" | "governance_audit" | "sovereignty_review" | "portfolio_review" | "guided_intake" | "charter" | "causal_ai";
export const STEP_ORDER: StepKey[] = ["guided_intake", "stabilization_map", "portfolio_review", "sovereignty_review", "governance_audit", "charter", "causal_ai"];

export interface WorkbenchObligation { kind: string; window_start: string; window_end: string; status: string }
export interface WorkbenchFacts {
  /** The tier that governs this household: its own when it stands alone, the family's when pooled. Null: no tier (nothing under management). */
  tier: string | null;
  hasRatifiedCharter: boolean;
  obligations: WorkbenchObligation[];
  /** A Portfolio Review is published and open to the client. */
  publishedReview: boolean;
}
export interface StepDecision { show: boolean; reason: string }

/** A review window starts being relevant this many days before it opens. */
export const LEAD_DAYS = 30;
const PORTFOLIO_TIERS = ["tier_1", "tier_2a", "tier_2b"];
const CHARTER_TIERS = ["tier_2b", "tier_3", "tier_4"];

const addDays = (iso: string, n: number) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const nice = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-CA", { timeZone: "UTC", month: "short", day: "numeric" });
const LIVE = ["open", "booked", "escalated", "paused"];

/** Is one of these kinds of review in (or within its lead time of) its window? Also the next window that has not started, for the reason text. */
export function windowState(obligations: WorkbenchObligation[], kinds: string[], today: string): { open: boolean; next: string | null } {
  const mine = obligations.filter((o) => kinds.includes(o.kind) && LIVE.includes(o.status));
  const open = mine.some((o) => today >= addDays(o.window_start, -LEAD_DAYS) && today <= o.window_end);
  const upcoming = mine.map((o) => o.window_start).filter((s) => s > today).sort()[0] ?? null;
  return { open, next: upcoming };
}

export function decideWorkbench(input: { facts: WorkbenchFacts | null; onboardingComplete: boolean; charterStarted: boolean; today: string }): Record<StepKey, StepDecision> {
  const { facts, onboardingComplete, charterStarted, today } = input;
  const yes = (): StepDecision => ({ show: true, reason: "" });
  const out = {} as Record<StepKey, StepDecision>;

  // Onboarding steps: only while onboarding is not complete.
  out.guided_intake = onboardingComplete ? { show: false, reason: "Onboarding is complete" } : yes();
  out.stabilization_map = onboardingComplete ? { show: false, reason: "Onboarding is complete" } : yes();

  // Without facts (they could not be loaded) nothing is hidden by tier or window.
  if (!facts) {
    for (const k of ["portfolio_review", "sovereignty_review", "governance_audit", "charter", "causal_ai"] as StepKey[]) out[k] = yes();
    return out;
  }
  const tier = facts.tier;

  // Portfolio Review: Tiers 1, 2A and 2B, from 30 days before its window opens until it closes, and while a published review is open.
  if (!tier || !PORTFOLIO_TIERS.includes(tier)) out.portfolio_review = facts.publishedReview ? yes() : { show: false, reason: tier ? "Not part of this tier" : "No service tier" };
  else {
    const w = windowState(facts.obligations, ["annual_review", "rebalancing"], today);
    out.portfolio_review = w.open || facts.publishedReview ? yes() : { show: false, reason: w.next ? `Next review window opens ${nice(w.next)}` : "No review window open" };
  }

  // Sovereignty Review and Governance Audit: chartered households and Tiers 2B, 3 and 4, in their review windows.
  const reviewEligible = facts.hasRatifiedCharter || (tier !== null && CHARTER_TIERS.includes(tier));
  const rw = windowState(facts.obligations, ["sovereignty_review", "governance_review"], today);
  const reviewDecision: StepDecision = !reviewEligible ? { show: false, reason: "Needs a Charter or Tier 2B and above" } : rw.open ? yes() : { show: false, reason: rw.next ? `Next review window opens ${nice(rw.next)}` : "No review window open" };
  out.sovereignty_review = reviewDecision;
  out.governance_audit = reviewDecision;

  // Charter and the Causal AI Workbench: households working on or holding a Charter (Tier 2B and above, or a Charter started).
  const charterDecision: StepDecision = facts.hasRatifiedCharter || charterStarted || (tier !== null && CHARTER_TIERS.includes(tier)) ? yes() : { show: false, reason: "No Charter, and below Tier 2B" };
  out.charter = charterDecision;
  out.causal_ai = charterDecision;
  return out;
}
