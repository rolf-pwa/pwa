// replacement-rules.ts: replacing a life insurance policy in BC. Two documents go to the client before the application for the new policy is started:
// the Life Insurance Replacement Declaration (fixed wording, signed by the client, the life insured if another person, and the agent) and a separate written
// explanation of the advantages and disadvantages of replacing, specific to the client. Pure.
import { assemble, type Evidence, type Fact, type FieldDef, type SourceType } from "./fact-find-rules.ts";

export const LIRD_TITLE = "Life Insurance Replacement Declaration";
export const LIRD_SOURCE = "Wording as published by the Insurance Council of British Columbia, Insurance Contracts (Life Insurance Replacement) Regulation, ICN #12-003, February 3, 2012.";
export const LIRD_CLIENT_STATEMENT = "I confirm that I have received this Life Insurance Replacement Declaration. I understand that typing my name below is my electronic signature, and that it has the same effect as signing on paper.";
export const LIRD_AGENT_STATEMENT = "I have given the client this document and a written explanation of the advantages and disadvantages of replacing their life insurance policy, before starting the application for a new policy.";
export const EXPLANATION_TITLE = "Your Life Insurance Replacement Explanation";

/** The Declaration, word for word as on the form (the signature lines are replaced by the portal's signing and the agent's signing). */
export const LIRD_MD = `**Do not cancel your existing policy until the new policy is in force and you accept it.** Before you cancel your life insurance policy you should have answers to the questions below. Ask any insurance agent or broker, or an independent person, for help if you need it.

## Questions about your present life insurance policy

1. Why do you want to replace your policy? Is the new policy better for you? How?
2. Should you just buy more insurance or change your policy? How much will these changes cost?
3. When should you cancel your present policy? When will your next annual dividend be paid? Will the timing affect your cancellation charges?
4. Will you pay more income tax if you cancel your present policy?

## Questions on the advantages and disadvantages of a new life insurance policy

1. Do you understand the type of insurance policy you are buying? Is it a term life, whole life, or universal life insurance policy? You should know the differences.
2. Are there times when the new policy will not pay all the benefits that your present policy does? Examples are suicide and contestable periods and contractual exclusions.
3. Will the new policy pay as much as your present policy? Examples are death benefits, cash values, and dividends.
4. Does the new policy have the same extra, or optional, benefits as your present policy? Examples are waiver of premium, guaranteed insurability, accidental death, and family member riders.
5. Are there cancellation charges on the new policy?
6. What guarantees apply to your present and proposed policies? Which policy has the best guarantees?
7. Will either of the policy premiums (payments) increase? For how long will the premiums stay the same? How much will they increase?

**Important:** Please ensure that the agent or broker provides you with copies of the written explanation of the advantages and disadvantages of replacing your life insurance policy with a new policy.

**Note:** Your agent or broker should deliver and review the new policy with you. If the policy is not satisfactory for any reason you may have a right to reject it and receive a full refund of premiums, under provincial or territorial law or under contract. Check the policy and the law for the right of rejection and the time limit for rejection.

${LIRD_SOURCE}`;

// ── The written explanation: one answer for each question on the Declaration ───────────────────────────────────────────
export const REPL_SECTIONS = [{ key: "present", label: "Your present policy" }, { key: "why", label: "Why replace, and what else you could do" }, { key: "new", label: "The new policy compared with your present one" }];
export const REPL_FIELDS: FieldDef[] = [
  { key: "present_policy", label: "Present policy", section: "present", origin: "file", ask: "The policy being replaced" },
  { key: "new_policy", label: "Proposed policy", section: "present", origin: "file", ask: "The proposed policy" },
  { key: "p_why", label: "Why you want to replace your policy", section: "why", origin: "model", ask: "Why the client wants to replace the policy" },
  { key: "p_better", label: "How the new policy is better for you", section: "why", origin: "model", ask: "How the new policy is better for the client" },
  { key: "p_alternatives", label: "Whether you should just buy more insurance or change your present policy, and what that would cost", section: "why", origin: "model", ask: "Whether adding cover or changing the present policy was considered, and the cost" },
  { key: "p_timing", label: "When to cancel your present policy: your next annual dividend and any cancellation charges", section: "why", origin: "model", ask: "When to cancel the present policy; next dividend date; cancellation charges and timing" },
  { key: "p_tax", label: "Income tax if you cancel your present policy", section: "why", origin: "model", ask: "Whether cancelling the present policy causes income tax" },
  { key: "n_type", label: "The type of policy you are buying, and how term, whole life and universal life differ", section: "new", origin: "model", ask: "The type of the new policy and how it differs from the others" },
  { key: "n_exclusions", label: "Times the new policy will not pay all the benefits your present policy does (suicide and contestable periods, exclusions)", section: "new", origin: "model", ask: "Suicide and contestable periods and exclusions on the new policy compared with the present one" },
  { key: "n_benefits", label: "Whether the new policy pays as much (death benefit, cash values, dividends)", section: "new", origin: "model", ask: "Death benefit, cash values and dividends, new compared with present" },
  { key: "n_riders", label: "Whether the extra benefits are the same (waiver of premium, guaranteed insurability, accidental death, family riders)", section: "new", origin: "model", ask: "Riders and optional benefits, new compared with present" },
  { key: "n_charges", label: "Cancellation charges on the new policy", section: "new", origin: "model", ask: "Cancellation or surrender charges on the new policy" },
  { key: "n_guarantees", label: "Guarantees on the present and the proposed policy, and which is best", section: "new", origin: "model", ask: "Guarantees on both policies, and which has the best" },
  { key: "n_premiums", label: "Whether premiums increase, for how long they stay the same, and by how much", section: "new", origin: "model", ask: "Premium increases on either policy: when and how much" },
];

const money = (n: number) => `$${Math.round(n).toLocaleString("en-CA")}`;
const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const words = (s: string) => String(s ?? "").replace(/_/g, " ");
const PER: Record<string, string> = { monthly: "a month", quarterly: "a quarter", semi_annual: "every six months", annual: "a year" };

export interface PresentPolicy { carrier: string; policy_type: string; policy_number?: string | null; coverage_amount?: number | string | null; premium_amount?: number | string | null; premium_frequency?: string | null; cash_value?: number | string | null; insured_name?: string | null }
export interface NewPolicyInput { product: string; carrier: string; coverage?: number | null; premium?: number | null; frequency?: string | null }

/** The two policies, as facts from the file and what Rolf entered. */
export function policyFacts(present: PresentPolicy, next: NewPolicyInput): Fact[] {
  const mk = (key: string, value: string, type: SourceType, label: string): Fact => { const d = REPL_FIELDS.find((f) => f.key === key)!; return { key, label: d.label, section: d.section, value, source: { type, label }, status: "proposed" }; };
  const pres = [`${words(present.policy_type)} with ${present.carrier}`, present.policy_number ? `policy ${present.policy_number}` : "", num(present.coverage_amount) ? `${money(num(present.coverage_amount))} of coverage` : "", num(present.premium_amount) ? `premium ${money(num(present.premium_amount))} ${PER[present.premium_frequency ?? ""] ?? ""}`.trim() : "", num(present.cash_value) ? `cash value ${money(num(present.cash_value))}` : ""].filter(Boolean).join(", ");
  const nw = [`${next.product.trim()} with ${next.carrier.trim()}`, next.coverage ? `${money(next.coverage)} of coverage` : "", next.premium ? `premium ${money(next.premium)} ${PER[next.frequency ?? ""] ?? ""}`.trim() : ""].filter(Boolean).join(", ");
  return [mk("present_policy", pres, "file", "Policy on file"), mk("new_policy", nw, "file", "Entered by Rolf")];
}
export const assembleReplacement = (fileFacts: Fact[], modelFacts: Fact[]) => assemble(fileFacts, modelFacts, REPL_FIELDS);

/** The written explanation the client reads: one answer under each question the Declaration asks. */
export function explanationMarkdown(firstNames: string, facts: Fact[]): string {
  const get = (k: string) => facts.find((f) => f.key === k)?.value.trim() ?? "";
  const part = (keys: string[]) => keys.flatMap((k) => { const f = facts.find((x) => x.key === k)!; return [`**${f.label}.**  ${get(k) || "Not applicable"}`]; });
  return [
    `Hi ${firstNames},`,
    "You are thinking about replacing a life insurance policy. Before we go any further, the law asks me to give you this written explanation of the advantages and disadvantages of replacing it, along with the Life Insurance Replacement Declaration. Please read both before any application is started, and ask me about anything that is not clear. **Do not cancel your present policy until the new policy is in force and you have accepted it.**",
    "## Your present policy and the proposed one",
    `**Present policy.**  ${get("present_policy")}`,
    `**Proposed policy.**  ${get("new_policy")}`,
    "## Why replace, and what else you could do",
    ...part(["p_why", "p_better", "p_alternatives", "p_timing", "p_tax"]),
    "## The new policy compared with your present one",
    ...part(["n_type", "n_exclusions", "n_benefits", "n_riders", "n_charges", "n_guarantees", "n_premiums"]),
    "If anything in this explanation about you, your needs or your policies is not correct, tell me right away. When the new policy is issued I will deliver it to you and go through it with you. If it is not satisfactory you may have a right to reject it and receive a full refund of premiums; the policy and the law set the time limit.",
    "Regards,\n\nRolf Issler, BMgt, CLU\n\nFinancial Planner\n\nProsperWise Advisors",
  ].join("\n\n");
}

export const REPL_ASKS = (facts: Fact[]) => facts.filter((f) => !f.value.trim()).map((f) => REPL_FIELDS.find((d) => d.key === f.key)?.ask ?? f.label);
export type { Evidence };
