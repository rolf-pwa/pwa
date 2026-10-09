// Canonical insurance_policies.policy_type values and labels — shared so
// InsurancePanel, ContactDetail, and HouseholdDetail can't silently drift
// apart on what a given policy_type string means.
export const POLICY_TYPES = [
  { value: "term", label: "Term Life" },
  { value: "whole_life", label: "Whole Life" },
  { value: "universal_life", label: "Universal Life" },
  { value: "critical_illness", label: "Critical Illness" },
  { value: "disability", label: "Disability" },
  { value: "long_term_care", label: "Long-Term Care" },
  { value: "other", label: "Other" },
];

export function policyTypeLabel(value: string | null | undefined): string {
  return POLICY_TYPES.find((t) => t.value === value)?.label || value || "Other";
}

// One policy number can carry several coverages (a Universal Life base plus term riders), stored as one
// insurance_policies row each. These helpers present them as a single policy with its riders nested.
export interface GroupablePolicy {
  id: string;
  contact_id?: string | null;
  corporation_id?: string | null;
  policy_number: string | null;
  insured_name?: string | null;
  policy_type: string;
  coverage_amount: number | null;
  renewal_date?: string | null;
}
export interface PolicyGroup<T extends GroupablePolicy> {
  key: string;
  /** The policy itself: the non-term coverage if there is one, else the largest. */
  base: T;
  riders: T[];
  /** Base plus riders. */
  totalCoverage: number;
}

const tok = (v: unknown) => String(v ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

export function groupPolicies<T extends GroupablePolicy>(policies: T[]): PolicyGroup<T>[] {
  const order: string[] = [];
  const byKey = new Map<string, T[]>();
  for (const p of policies) {
    // Rows without a policy number can't be told to belong together, so each stands alone.
    const key = p.policy_number ? `${p.contact_id ?? p.corporation_id ?? ""}|${tok(p.policy_number)}|${tok(p.insured_name)}` : `solo:${p.id}`;
    if (!byKey.has(key)) { byKey.set(key, []); order.push(key); }
    byKey.get(key)!.push(p);
  }
  return order.map((key) => {
    const rows = byKey.get(key)!;
    const cov = (r: T) => Number(r.coverage_amount) || 0;
    const base = [...rows].sort((a, b) => (a.policy_type === "term" ? 1 : 0) - (b.policy_type === "term" ? 1 : 0) || cov(b) - cov(a))[0];
    const riders = rows
      .filter((r) => r.id !== base.id)
      .sort((a, b) => (a.renewal_date ?? "9999").localeCompare(b.renewal_date ?? "9999") || cov(b) - cov(a));
    return { key, base, riders, totalCoverage: rows.reduce((n, r) => n + cov(r), 0) };
  });
}
