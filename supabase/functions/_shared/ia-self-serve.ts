// ia-self-serve.ts: what a client can do themselves in iA's My Client Space, from iA's guide "List of transactions available online"
// (SRM503-178A, March 2026) and Rolf's notes: investments are deposits only for now, and withdrawals are never self-serve. Pure; no I/O.
// Georgia says only what this returns. Where the CRM cannot tell (the policy type does not name the iA product), the answer is "unknown"
// and she hands the request to Rolf rather than guess.

export type Modernized = boolean | null;

export const ACCESS_LIFE_SINCE = "2024-04-01";
export const TRANSITION_SINCE = "2025-11-24";
export const TERM_WHOLE_SINCE = "2026-03-30";

export interface PolicyFacts {
  /** insurance_policies.policy_type: term, whole_life, universal_life, critical_illness, disability, long_term_care, other. */
  policy_type: string | null;
  issue_date: string | null;
  /** Anything that names the iA product (a plan name or note), for the cases the type cannot settle. */
  hint?: string | null;
}

export interface ModernizedAnswer { modernized: Modernized; why: string }

const day = (d: string | null | undefined) => (d ? String(d).slice(0, 10) : null);

/**
 * Whether a policy is a "modernized" contract: Access Life sold since April 2024, Transition sold since 24 November 2025, and Term and Whole Life
 * sold since 30 March 2026. Participating and Universal Life never are, and neither are the living-benefits products. The CRM's policy type
 * does not separate Access Life from Term or Whole Life, or Participating from Whole Life, so those return null unless a hint names the product.
 */
export function isModernized(p: PolicyFacts): ModernizedAnswer {
  const type = String(p.policy_type ?? "").toLowerCase();
  const issued = day(p.issue_date);
  const hint = String(p.hint ?? "").toLowerCase();
  const no = (why: string): ModernizedAnswer => ({ modernized: false, why });
  const unknown = (why: string): ModernizedAnswer => ({ modernized: null, why });

  if (/participating/.test(hint)) return no("Participating Life is not a modernized contract");
  if (/cancer guard|accifamily|acci 7|disability/.test(hint)) return no("A living-benefits product is not a modernized contract");
  if (/universal/.test(hint)) return no("Universal Life is not a modernized contract");
  if (!issued) return unknown("The policy has no issue date");
  if (/access life|simplified issue/.test(hint)) return issued >= ACCESS_LIFE_SINCE ? { modernized: true, why: "Access Life sold since April 2024" } : no("Access Life sold before April 2024");
  if (/transition/.test(hint)) return issued >= TRANSITION_SINCE ? { modernized: true, why: "Transition sold since 24 November 2025" } : no("Transition sold before 24 November 2025");

  switch (type) {
    case "universal_life": return no("Universal Life is not a modernized contract");
    case "disability":
    case "long_term_care": return no("A living-benefits product is not a modernized contract");
    case "critical_illness":
      return issued < TRANSITION_SINCE ? no("Sold before Transition existed") : unknown("A critical illness policy could be Transition or Cancer Guard, and the CRM does not record which");
    case "term":
      if (issued < ACCESS_LIFE_SINCE) return no("Sold before April 2024");
      if (issued >= TERM_WHOLE_SINCE) return { modernized: true, why: "Term Life sold since 30 March 2026" };
      return unknown("A term policy from April 2024 to March 2026 could be Access Life (modernized) or ordinary Term (not), and the CRM does not record which");
    case "whole_life":
      if (issued < ACCESS_LIFE_SINCE) return no("Sold before April 2024");
      return unknown("A whole life policy from April 2024 on could be Access Life, Whole Life or Participating Life, and the CRM does not record which");
    default:
      return unknown("The policy type does not say which iA product it is");
  }
}

export type Capability =
  | "insurance_banking" | "insurance_payment_date" | "insurance_contact"
  | "insurance_payment_method" | "insurance_delay_stop_reinstate"
  | "investment_deposit";

/** The self-serve list, as data so a new item is switched on here (investments are rolling out) and not written into a prompt. */
export const CAPABILITY_LABEL: Record<Capability, string> = {
  insurance_banking: "change the banking information on an insurance policy",
  insurance_payment_date: "change an insurance payment date",
  insurance_contact: "change contact information",
  insurance_payment_method: "change how often or how an insurance policy is paid",
  insurance_delay_stop_reinstate: "delay, stop or restart insurance payments",
  investment_deposit: "make a deposit into an investment account",
};

/** Investment capabilities iA has released. Withdrawals and banking changes on investment accounts are never in this list. */
export const INVESTMENT_CAPABILITIES_LIVE: Capability[] = ["investment_deposit"];

/** What the client can do alone for one insurance policy: the all-contracts list, plus the modernized extras. Unknown adds nothing, so nothing is overstated. */
export function insuranceSelfServe(m: Modernized): Capability[] {
  const all: Capability[] = ["insurance_banking", "insurance_payment_date", "insurance_contact"];
  return m === true ? [...all, "insurance_payment_method", "insurance_delay_stop_reinstate"] : all;
}

export const investmentSelfServe = (): Capability[] => [...INVESTMENT_CAPABILITIES_LIVE];

/** Things that are never self-serve here, whatever iA allows. */
export const NEVER_SELF_SERVE = ["withdrawal", "investment_banking_change", "transfer", "investment_instruction"] as const;
