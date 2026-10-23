// coverage-by-kind.ts: insurance in force by kind of cover, for the advisor's reports. Pure. A monthly disability benefit is never added to the face amount of a
// life policy or the lump sum of a critical illness policy (a test keeps this in step with src/shared/lib/insuranceSummary.ts).

export interface CoverageByKind { life: number; critical_illness: number; disability_monthly: number; long_term_care: number; other: number }

const num = (v: unknown) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 0);
const money = (n: number) => `$${Math.round(n).toLocaleString("en-CA")}`;

export function coverageByKind(policies: { policy_type?: string | null; coverage_amount?: unknown }[]): CoverageByKind {
  const t: CoverageByKind = { life: 0, critical_illness: 0, disability_monthly: 0, long_term_care: 0, other: 0 };
  for (const p of policies) {
    const a = num(p.coverage_amount), type = p.policy_type;
    if (type === "term" || type === "whole_life" || type === "universal_life") t.life += a;
    else if (type === "critical_illness") t.critical_illness += a;
    else if (type === "disability") t.disability_monthly += a;
    else if (type === "long_term_care") t.long_term_care += a;
    else t.other += a;
  }
  return t;
}

/** The capital protected by lump sums: life plus critical illness. This is what "asset protection" means in the reports. */
export const lumpSumCoverage = (c: CoverageByKind): number => c.life + c.critical_illness;

/** "life $1,000,000; critical illness $100,000; disability $4,100 a month", only the kinds present. Empty when there is none. */
export function coverageSentence(c: Partial<CoverageByKind> | null | undefined): string {
  if (!c) return "";
  const parts = [
    num(c.life) && `life ${money(num(c.life))}`,
    num(c.critical_illness) && `critical illness ${money(num(c.critical_illness))}`,
    num(c.disability_monthly) && `disability ${money(num(c.disability_monthly))} a month`,
    num(c.long_term_care) && `long-term care ${money(num(c.long_term_care))}`,
  ].filter(Boolean);
  return parts.join("; ");
}
