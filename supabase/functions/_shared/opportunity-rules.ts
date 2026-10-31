// opportunity-rules.ts: the book-of-business rulebook. Pure; no I/O.
// A rule fires only on stored data, and says what triggered it. Where a rule's inputs are missing it reports a data gap
// instead of staying quiet, so "no data" is never mistaken for "nothing to offer". Staff only: nothing here is client wording.
// The gatherer (opportunity-snapshot.ts) builds a HouseholdSnapshot; this file never touches the database.

export type OpportunityType =
  | "insurance_coverage_gap"
  | "debt_protection"
  | "charter_candidate"
  | "tier_upgrade"
  | "consolidation"
  | "corporate_structuring"
  | "estate_gap"
  | "idle_cash"
  | "policy_event";

/** Bump when a rule's meaning changes, so stored findings show which version produced them. */
export const RULE_VERSION = "1";

export type Confidence = "high" | "medium" | "low";

export interface Member { id: string; name: string; role: string | null; isMinor: boolean }
export interface AccountLine { id: string; name: string; type: string | null; value: number; custodian: string | null; beneficiary: string | null; owner: string }
export interface PolicyLine { id: string; type: string; coverage: number; cashValue: number; renewalDate: string | null; insuredContactId: string | null; corporate: boolean }
export interface NeedsLine { contactId: string; need: number; available: number; shortfall: number; createdAt: string }
export interface DebtLine { id: string; type: string; balance: number; corporate: boolean }
export interface CorporationLine { id: string; name: string; totalAssets: number }

export interface HouseholdSnapshot {
  householdId: string;
  label: string;
  members: Member[];
  /** AUM directly under management (custodian iA / JustWealth), pooled across the family; the tier basis. */
  groupedAum: number;
  totalAum: number;
  tier: string | null;
  hasRatifiedCharter: boolean;
  accounts: AccountLine[];
  policies: PolicyLine[];
  lifeCoverage: number;
  needs: NeedsLine[];
  debts: DebtLine[];
  corporations: CorporationLine[];
  /** Annual passive income held in the corporations, from the charter; null when not recorded. */
  corporatePassiveIncome: number | null;
  sbdClawback: number | null;
  holdingTank: number;
  liquidityReserve: number;
  liquidityTarget: number;
  /** Named professionals on any member's record. */
  professionals: { lawyer: boolean; executor: boolean; poa: boolean };
}

export interface Finding {
  householdId: string;
  type: OpportunityType;
  /** Distinguishes several findings of one type in a household (a person, an account); with the type it dedupes weekly runs. */
  key: string;
  title: string;
  evidence: { label: string; value: string }[];
  confidence: Confidence;
  nextStep: string;
  /** Left null until the iA commission schedule is wired in. */
  estValue: number | null;
}

export interface DataGap {
  householdId: string;
  field: string;
  why: string;
  blocks: OpportunityType[];
}

export interface RuleConfig {
  /** Debt below this is not worth a protection conversation. */
  debtFloor: number;
  /** Grouped AUM at which a Charter conversation makes sense. */
  charterAumFloor: number;
  /** "Near" a tier threshold: within this share below it. */
  upgradeMargin: number;
  tierThresholds: number[];
  /** Cash in the holding tank (not yet placed) worth raising. */
  idleCashFloor: number;
  /** Passive income from which the small-business-deduction clawback starts to bite (the grind begins at $50k). */
  passiveIncomeWatch: number;
  /** Outside (not under management) account value worth raising. */
  consolidationFloor: number;
  policyEventDays: number;
  /** A reserve this far above its target counts as surplus. */
  reserveSurplusPct: number;
  /** Staleness of a needs analysis, in months. */
  needsStaleMonths: number;
}

export const DEFAULT_CONFIG: RuleConfig = {
  debtFloor: 50_000,
  charterAumFloor: 250_000,
  upgradeMargin: 0.15,
  tierThresholds: [250_000, 750_000, 2_000_000],
  idleCashFloor: 25_000,
  passiveIncomeWatch: 40_000,
  consolidationFloor: 25_000,
  policyEventDays: 90,
  reserveSurplusPct: 0.25,
  needsStaleMonths: 24,
};

export interface Evaluation {
  findings: Finding[];
  gaps: DataGap[];
  /** Share of the inputs the rules need that are on file, 0 to 1. */
  completeness: number;
  inputsPresent: number;
  inputsTotal: number;
}

const money = (n: number) => `$${Math.round(n).toLocaleString("en-CA")}`;
const REGISTERED = /\b(RRSP|RRIF|TFSA|LIRA|LIF|RDSP|LRIF|PRIF|RLIF|SPOUSAL|LOCKED)\b/i;
const MANAGED = ["iA Financial Group", "JustWealth"];
const isAdult = (m: Member) => !m.isMinor && m.role !== "minor";
const daysBetween = (from: string, to: string) => Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86_400_000);
const monthsBetween = (from: string, to: string) => daysBetween(from, to) / 30.4375;

type RuleOut = { findings: Finding[]; gaps: DataGap[]; present: number; total: number };
type Rule = (s: HouseholdSnapshot, cfg: RuleConfig, today: string) => RuleOut;

const out = (): RuleOut => ({ findings: [], gaps: [], present: 0, total: 0 });
/** Counts one required input; records a gap when it is missing. */
function need(o: RuleOut, s: HouseholdSnapshot, present: boolean, field: string, why: string, blocks: OpportunityType[]) {
  o.total += 1;
  if (present) o.present += 1;
  else o.gaps.push({ householdId: s.householdId, field, why, blocks });
}

const insuranceRule: Rule = (s, cfg, today) => {
  const o = out();
  const adults = s.members.filter(isAdult);
  const dependants = s.members.some((m) => m.isMinor || m.role === "minor");
  const debt = s.debts.filter((d) => !d.corporate).reduce((t, d) => t + d.balance, 0);
  need(o, s, adults.length > 0, "Adult members", "Cover is assessed per adult; none are on the household.", ["insurance_coverage_gap"]);

  for (const m of adults) {
    const latest = s.needs.filter((n) => n.contactId === m.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    need(o, s, !!latest, `Needs analysis: ${m.name}`, "Without a needs analysis the cover gap is a guess.", ["insurance_coverage_gap"]);
    if (latest && latest.shortfall > 0) {
      const stale = monthsBetween(latest.createdAt.slice(0, 10), today) > cfg.needsStaleMonths;
      o.findings.push({
        householdId: s.householdId, type: "insurance_coverage_gap", key: `shortfall:${m.id}`,
        title: `${m.name}: life cover short of the need by ${money(latest.shortfall)}`,
        evidence: [
          { label: "Total need", value: money(latest.need) }, { label: "Already available", value: money(latest.available) },
          { label: "Shortfall", value: money(latest.shortfall) }, { label: "Analysis dated", value: latest.createdAt.slice(0, 10) },
        ],
        confidence: stale ? "medium" : "high",
        nextStep: stale ? "The analysis is more than two years old; refresh it, then discuss the shortfall." : "Raise the shortfall at the next meeting and offer a quote.",
        estValue: null,
      });
    }
  }

  const noNeeds = adults.filter((m) => !s.needs.some((n) => n.contactId === m.id));
  if (s.lifeCoverage <= 0 && noNeeds.length > 0 && (dependants || debt >= cfg.debtFloor)) {
    o.findings.push({
      householdId: s.householdId, type: "insurance_coverage_gap", key: "no-life-cover",
      title: "No life cover on file, with " + (dependants ? "dependants" : "debt") + " in the household",
      evidence: [
        { label: "Life cover on file", value: "$0" }, { label: "Dependants", value: dependants ? "Yes" : "No" },
        { label: "Personal debt", value: money(debt) },
      ],
      confidence: "medium",
      nextStep: "Confirm there is no cover held elsewhere, then run a needs analysis.",
      estValue: null,
    });
  }

  const hasDisability = s.policies.some((p) => p.type === "disability" || p.type === "critical_illness");
  if (adults.length > 0 && !hasDisability && s.policies.length + s.needs.length > 0) {
    o.findings.push({
      householdId: s.householdId, type: "insurance_coverage_gap", key: "no-disability-ci",
      title: "No disability or critical illness cover on file",
      evidence: [{ label: "Disability / CI policies", value: "0" }, { label: "Policies of any kind", value: String(s.policies.length) }],
      confidence: "low",
      nextStep: "Ask about income protection; income is not on file, so size it in the fact find.",
      estValue: null,
    });
  }
  return o;
};

const debtRule: Rule = (s, cfg) => {
  const o = out();
  const personal = s.debts.filter((d) => !d.corporate && d.type === "mortgage");
  const total = personal.reduce((t, d) => t + d.balance, 0);
  if (total >= cfg.debtFloor && s.lifeCoverage < total) {
    o.findings.push({
      householdId: s.householdId, type: "debt_protection", key: "mortgage",
      title: `Mortgage of ${money(total)} exceeds life cover of ${money(s.lifeCoverage)}`,
      evidence: [{ label: "Mortgage balance", value: money(total) }, { label: "Life cover on file", value: money(s.lifeCoverage) }],
      // Debts carry no link to a policy, so the match is by totals only.
      confidence: "medium",
      nextStep: "Check whether cover is tied to the mortgage elsewhere; if not, offer mortgage protection.",
      estValue: null,
    });
  }
  return o;
};

const charterRule: Rule = (s, cfg) => {
  const o = out();
  need(o, s, s.groupedAum > 0, "Assets under management", "Charter fit is judged on grouped AUM, and none is recorded.", ["charter_candidate", "tier_upgrade", "idle_cash"]);
  if (!s.hasRatifiedCharter && s.groupedAum >= cfg.charterAumFloor) {
    o.findings.push({
      householdId: s.householdId, type: "charter_candidate", key: "charter",
      title: `No Sovereignty Charter on a ${money(s.groupedAum)} household`,
      evidence: [{ label: "Grouped AUM", value: money(s.groupedAum) }, { label: "Tier", value: s.tier ?? "not set" }, { label: "Ratified charter", value: "None" }],
      confidence: s.tier ? "high" : "medium",
      nextStep: "Offer the Sovereignty Charter build (Strategy engagement) at the next review.",
      estValue: null,
    });
  }
  return o;
};

const tierRule: Rule = (s, cfg) => {
  const o = out();
  if (s.groupedAum <= 0) return o;
  const next = [...cfg.tierThresholds].sort((a, b) => a - b).find((t) => t > s.groupedAum);
  if (next && s.groupedAum >= next * (1 - cfg.upgradeMargin)) {
    o.findings.push({
      householdId: s.householdId, type: "tier_upgrade", key: `to-${next}`,
      title: `${money(next - s.groupedAum)} short of the ${money(next)} tier line`,
      evidence: [{ label: "Grouped AUM", value: money(s.groupedAum) }, { label: "Next threshold", value: money(next) }, { label: "Current tier", value: s.tier ?? "not set" }],
      confidence: "high",
      nextStep: "Look for outside assets or contributions that would cross the line.",
      estValue: null,
    });
  }
  return o;
};

const consolidationRule: Rule = (s, cfg) => {
  const o = out();
  const noCustodian = s.accounts.filter((a) => !a.custodian);
  need(o, s, s.accounts.length === 0 || noCustodian.length === 0, "Account custodian", `${noCustodian.length} account(s) have no custodian, so management status is unknown.`, ["consolidation", "tier_upgrade", "charter_candidate"]);
  const outside = s.accounts.filter((a) => a.custodian && !MANAGED.includes(a.custodian) && a.value > 0);
  const total = outside.reduce((t, a) => t + a.value, 0);
  if (total >= cfg.consolidationFloor) {
    o.findings.push({
      householdId: s.householdId, type: "consolidation", key: "outside-accounts",
      title: `${money(total)} held outside management across ${outside.length} account${outside.length === 1 ? "" : "s"}`,
      evidence: outside.map((a) => ({ label: `${a.owner}: ${a.name} (${a.custodian})`, value: money(a.value) })),
      confidence: "high",
      nextStep: "Ask what keeps these where they are, and whether a transfer in makes sense.",
      estValue: null,
    });
  }
  return o;
};

const corporateRule: Rule = (s, cfg) => {
  const o = out();
  if (s.corporations.length === 0) return o;
  need(o, s, s.corporatePassiveIncome !== null, "Corporate passive income", "The corporation's passive income is not recorded, so the small-business-deduction exposure cannot be judged.", ["corporate_structuring"]);
  if (s.corporatePassiveIncome !== null && s.corporatePassiveIncome >= cfg.passiveIncomeWatch) {
    const over = s.corporatePassiveIncome > 50_000;
    o.findings.push({
      householdId: s.householdId, type: "corporate_structuring", key: "passive-income",
      title: over
        ? `Passive income of ${money(s.corporatePassiveIncome)} is over the $50,000 line`
        : `Passive income of ${money(s.corporatePassiveIncome)} is close to the $50,000 line`,
      evidence: [
        { label: "Corporate passive income", value: money(s.corporatePassiveIncome) },
        ...(s.sbdClawback !== null ? [{ label: "Small business deduction at risk", value: money(s.sbdClawback) }] : []),
        { label: "Corporations", value: s.corporations.map((c) => c.name).join(", ") },
      ],
      confidence: "high",
      nextStep: "Review the structure with the accountant (holdco, insurance, or income timing) before year end.",
      estValue: null,
    });
  }
  return o;
};

const estateRule: Rule = (s) => {
  const o = out();
  const registered = s.accounts.filter((a) => a.type && REGISTERED.test(a.type));
  const unnamed = registered.filter((a) => !a.beneficiary || !a.beneficiary.trim());
  o.total += 1;
  if (unnamed.length === 0) o.present += 1;
  // The missing record is the opportunity here, so these are findings rather than gaps; a dismissal ("already in place") closes them.
  if (unnamed.length > 0) {
    o.findings.push({
      householdId: s.householdId, type: "estate_gap", key: "beneficiaries",
      title: `${unnamed.length} registered account${unnamed.length === 1 ? "" : "s"} with no beneficiary on file`,
      evidence: unnamed.map((a) => ({ label: `${a.owner}: ${a.name}`, value: money(a.value) })),
      confidence: "medium",
      nextStep: "Confirm the designations with the client and record them.",
      estValue: null,
    });
  }
  const missing = (["lawyer", "executor", "poa"] as const).filter((k) => !s.professionals[k]);
  o.total += 1;
  if (missing.length === 0) o.present += 1;
  if (missing.length > 0 && s.members.some(isAdult)) {
    const label = { lawyer: "a lawyer", executor: "an executor", poa: "a power of attorney" } as const;
    o.findings.push({
      householdId: s.householdId, type: "estate_gap", key: "professionals",
      title: `No ${missing.map((k) => label[k]).join(", ")} on file`,
      evidence: missing.map((k) => ({ label: k === "poa" ? "Power of attorney" : k[0].toUpperCase() + k.slice(1), value: "Not recorded" })),
      confidence: "low",
      nextStep: "Ask who holds these roles; refer to an estate lawyer if the will or POA is out of date.",
      estValue: null,
    });
  }
  return o;
};

const idleCashRule: Rule = (s, cfg) => {
  const o = out();
  if (s.holdingTank >= cfg.idleCashFloor) {
    o.findings.push({
      householdId: s.householdId, type: "idle_cash", key: "holding-tank",
      title: `${money(s.holdingTank)} waiting in the holding tank`,
      evidence: [{ label: "Holding tank balance", value: money(s.holdingTank) }],
      confidence: "high",
      nextStep: "Place it per the Storehouse rules, or ask what it is waiting for.",
      estValue: null,
    });
  }
  need(o, s, s.liquidityTarget > 0 || s.liquidityReserve === 0, "Liquidity reserve target", "The Liquidity reserve has money but no target, so surplus cannot be judged.", ["idle_cash"]);
  if (s.liquidityTarget > 0 && s.liquidityReserve > s.liquidityTarget * (1 + cfg.reserveSurplusPct) && s.liquidityReserve - s.liquidityTarget >= cfg.idleCashFloor) {
    o.findings.push({
      householdId: s.householdId, type: "idle_cash", key: "liquidity-surplus",
      title: `Liquidity reserve is ${money(s.liquidityReserve - s.liquidityTarget)} above its target`,
      evidence: [{ label: "Liquidity reserve", value: money(s.liquidityReserve) }, { label: "Target", value: money(s.liquidityTarget) }],
      confidence: "medium",
      nextStep: "Offer to move the surplus into the Strategic reserve.",
      estValue: null,
    });
  }
  return o;
};

const policyEventRule: Rule = (s, cfg, today) => {
  const o = out();
  for (const p of s.policies) {
    if (!p.renewalDate) continue;
    const days = daysBetween(today, p.renewalDate);
    if (days >= 0 && days <= cfg.policyEventDays) {
      o.findings.push({
        householdId: s.householdId, type: "policy_event", key: `renewal:${p.id}`,
        title: `${p.type.replace(/_/g, " ")} policy renews in ${days} day${days === 1 ? "" : "s"}`,
        evidence: [{ label: "Renewal date", value: p.renewalDate }, { label: "Coverage", value: money(p.coverage) }],
        confidence: "high",
        nextStep: "Review whether the cover still fits; this is a natural moment to revisit the need.",
        estValue: null,
      });
    }
  }
  return o;
};

export const RULES: Rule[] = [insuranceRule, debtRule, charterRule, tierRule, consolidationRule, corporateRule, estateRule, idleCashRule, policyEventRule];

export function evaluateHousehold(s: HouseholdSnapshot, today: string, cfg: RuleConfig = DEFAULT_CONFIG): Evaluation {
  const findings: Finding[] = [];
  const gaps: DataGap[] = [];
  let present = 0, total = 0;
  for (const rule of RULES) {
    const r = rule(s, cfg, today);
    findings.push(...r.findings);
    gaps.push(...r.gaps);
    present += r.present;
    total += r.total;
  }
  const rank = { high: 0, medium: 1, low: 2 } as const;
  findings.sort((a, b) => rank[a.confidence] - rank[b.confidence]);
  return { findings, gaps, completeness: total === 0 ? 1 : present / total, inputsPresent: present, inputsTotal: total };
}

export interface BookSummary {
  households: number;
  findingsByType: Record<string, number>;
  findingsByConfidence: Record<Confidence, number>;
  /** Most common missing inputs, so the data work can be aimed where it unblocks most rules. */
  topGaps: { field: string; households: number }[];
  averageCompleteness: number;
}

/** Collapses per-person fields ("Needs analysis: Name") to the field kind so the same gap counts once across households. */
const gapKind = (field: string) => field.split(":")[0];

export function summarizeBook(evals: { householdId: string; evaluation: Evaluation }[]): BookSummary {
  const findingsByType: Record<string, number> = {};
  const findingsByConfidence: Record<Confidence, number> = { high: 0, medium: 0, low: 0 };
  const gapHouseholds = new Map<string, Set<string>>();
  for (const { householdId, evaluation } of evals) {
    for (const f of evaluation.findings) {
      findingsByType[f.type] = (findingsByType[f.type] ?? 0) + 1;
      findingsByConfidence[f.confidence] += 1;
    }
    for (const g of evaluation.gaps) {
      const k = gapKind(g.field);
      if (!gapHouseholds.has(k)) gapHouseholds.set(k, new Set());
      gapHouseholds.get(k)!.add(householdId);
    }
  }
  const topGaps = [...gapHouseholds.entries()].map(([field, set]) => ({ field, households: set.size })).sort((a, b) => b.households - a.households);
  const avg = evals.length ? evals.reduce((t, e) => t + e.evaluation.completeness, 0) / evals.length : 1;
  return { households: evals.length, findingsByType, findingsByConfidence, topGaps, averageCompleteness: Math.round(avg * 1000) / 1000 };
}
