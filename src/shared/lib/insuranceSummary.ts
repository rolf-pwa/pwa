// insuranceSummary.ts: the coverage summary on the Insurance tab. Pure. Each insurance_policies row is one coverage (a Universal Life base and its term
// riders are separate rows), so amounts are summed per row and policies are counted once per policy number.
import { groupPolicies, type GroupablePolicy } from "./insurance";

export type Category = "life" | "critical_illness" | "disability" | "long_term_care" | "other";
export const CATEGORY_LABEL: Record<Category, string> = { life: "Life", critical_illness: "Critical illness", disability: "Disability", long_term_care: "Long-term care", other: "Other" };
export const categoryOf = (policyType: string | null | undefined): Category =>
  policyType === "term" || policyType === "whole_life" || policyType === "universal_life" ? "life"
    : policyType === "critical_illness" ? "critical_illness" : policyType === "disability" ? "disability" : policyType === "long_term_care" ? "long_term_care" : "other";

export interface SummaryPolicy extends GroupablePolicy {
  carrier?: string | null;
  premium_amount?: number | string | null;
  premium_frequency?: string | null;
  cash_value?: number | string | null;
  renewal_date?: string | null;
}
export interface Person { id: string; name: string }

const PER_YEAR: Record<string, number> = { monthly: 12, quarterly: 4, semi_annual: 2, annual: 1 };
const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
/** What a premium costs over a year. A single premium and a missing frequency count as nothing a year. */
export const annualPremium = (p: Pick<SummaryPolicy, "premium_amount" | "premium_frequency">): number => num(p.premium_amount) * (PER_YEAR[String(p.premium_frequency ?? "")] ?? 0);

export interface Totals { coverage: Record<Category, number>; premiumsPerYear: number; cashValue: number; policies: number }
const empty = (): Totals => ({ coverage: { life: 0, critical_illness: 0, disability: 0, long_term_care: 0, other: 0 }, premiumsPerYear: 0, cashValue: 0, policies: 0 });

export function totalsFor(policies: SummaryPolicy[]): Totals {
  const t = empty();
  for (const p of policies) {
    t.coverage[categoryOf(p.policy_type)] += num(p.coverage_amount);
    t.premiumsPerYear += annualPremium(p);
    t.cashValue += num(p.cash_value);
  }
  t.policies = groupPolicies(policies).length;
  return t;
}

export interface PersonRow extends Totals { id: string; name: string; hasLife: boolean }
export interface Summary { overall: Totals; byPerson: PersonRow[]; others: Totals | null; renewals: { policy: SummaryPolicy; days: number; owner: string }[] }

/** Everything by person (owners that are people), anything owned by a corporation grouped as "others", and renewals in the next 90 days. */
export function summarize(policies: SummaryPolicy[], people: Person[], today: string): Summary {
  const mine = (id: string) => policies.filter((p) => p.contact_id === id);
  const byPerson = people.map((pr) => { const t = totalsFor(mine(pr.id)); return { ...t, id: pr.id, name: pr.name, hasLife: t.coverage.life > 0 }; });
  const corp = policies.filter((p) => !p.contact_id || !people.some((pr) => pr.id === p.contact_id));
  const ownerName = (p: SummaryPolicy) => people.find((pr) => pr.id === p.contact_id)?.name ?? "A corporation";
  const t0 = Date.parse(`${today}T12:00:00Z`);
  const renewals = policies
    .filter((p) => p.renewal_date)
    .map((p) => ({ policy: p, days: Math.round((Date.parse(`${p.renewal_date}T12:00:00Z`) - t0) / 86_400_000), owner: ownerName(p) }))
    .filter((r) => r.days >= 0 && r.days <= 90)
    .sort((a, b) => a.days - b.days);
  return { overall: totalsFor(policies), byPerson, others: corp.length ? totalsFor(corp) : null, renewals };
}

const cad = (n: number) => `$${Math.round(n).toLocaleString("en-CA")}`;
/** A coverage amount the way a client reads it: a disability benefit is paid monthly, the rest are lump sums or face amounts. */
export const coverageText = (c: Category, amount: number): string => (c === "disability" ? `${cad(amount)} a month` : cad(amount));

export interface CoverageLine { category: Category; label: string; total: number; text: string; policies: number }
/** Coverage in force by kind of cover, for the client's portal: only the kinds they have, each in its own terms (never one total across life and disability). */
export function coverageSummary(policies: SummaryPolicy[]): CoverageLine[] {
  const out: CoverageLine[] = [];
  for (const category of ["life", "critical_illness", "disability", "long_term_care", "other"] as Category[]) {
    const mine = policies.filter((p) => categoryOf(p.policy_type) === category);
    if (!mine.length) continue;
    const total = mine.reduce((n, p) => n + num(p.coverage_amount), 0);
    if (category === "other" && total === 0) continue;
    out.push({ category, label: CATEGORY_LABEL[category], total, text: coverageText(category, total), policies: groupPolicies(mine).length });
  }
  return out;
}
