// Pure logic for the Sovereignty Review's status cards. The cards follow the family's Vineyard and Storehouse
// framework, the same lines as the balance sheet: Charter, Vineyard, Liquidity Reserve, Strategic Reserve,
// Philanthropic Trust, Legacy Trust, Liabilities. Each reads the SAME allocated figures the balance sheet shows,
// so the two can never disagree, and each is tested against the Charter's numeric targets in code.
// Statuses and figures are decided here, never by the AI; the AI only writes the Charter notes and the plan.
// Tax is deliberately not a card (a separate projection will cover it).

import type { TargetArea, TargetResult } from "./charter-targets.ts";

export type AlignStatus = "Aligned" | "Partial" | "Needs Attention" | "Not Assessed";

export interface ReviewCard {
  key: string;
  label: string;
  status: AlignStatus;
  detail: string;
  /** Charter targets for this area, already checked against the balance sheet. */
  targets?: TargetResult[];
  /** One sentence from the AI saying whether the area meets the Charter's provisions (never changes the status). */
  charter_note?: string;
}

export interface EstateAdult {
  name: string;
  will: "signed" | "unsigned" | "missing";
  willDate: string | null;
  poa: "on_file" | "missing";
}

export interface EstateFacts {
  /** documents = read from the Vault and approved in Glass-Box; manual = typed on the Stabilization Map; none = nothing. */
  source: "documents" | "manual" | "none";
  adults: EstateAdult[];
  trusts: number;
  manual?: { will: string | null; poa: string | null; beneficiaries: string | null };
}

export interface ReviewFacts {
  charter: { source: "vault" | "household" | "contact" | null; ratified: boolean; hasVision: boolean };
  balance: {
    vineyard: number; holdingTank: number; liquidity: number; strategic: number; philanthropic: number; legacy: number;
    totalAssets: number; liabilities: number; netWorth: number;
    realEstate: number; cashValue: number; incomeFundsInLiquidity: number;
  };
  vineyard: {
    accountCount: number;          // accounts that issue a statement
    statementsRead: number;        // of those, read from a statement this quarter
    staleCount: number;            // read, but not updated within the freshness window
    statementsFiled: boolean | null;
    withdrawalsYtd: number | null;
  };
  liquidity: { setUp: boolean; target: number | null };
  strategic: { policyCount: number; coverageTotal: number; missingCoverageCount: number; missingBeneficiaryCount: number; renewalsDueSoon: number; documentsFiled: boolean | null };
  legacy: { realEstate: number; estate: EstateFacts };
  liabilities: { total: number; corporate: number; overdueLoans: number; revolving?: { limit: number; available: number } | null };
  targets: TargetResult[];
  /** What the statements have given us so far (optional: omitted when not looked up). */
  statementData?: { accounts: number; withIncomeFunds: number; withWithdrawals: number } | null;
  corporate?: { activeAssetRatio: number | null; usaOnFile: boolean | null; usaStale: boolean | null; sbdClawback: number | null } | null;
}

const money = (n: number) => `$${Math.round(n).toLocaleString("en-CA")}`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Calendar quarter the review is conducted in, e.g. "2026 Q4". */
export function quarterLabel(d: Date): string {
  return `${d.getUTCFullYear()} Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
}

/** A target that is short of, or over, the Charter's limit makes the area Needs Attention. */
function withTargets(status: AlignStatus, targets: TargetResult[]): AlignStatus {
  return targets.some((t) => t.status === "below" || t.status === "above") ? "Needs Attention" : status;
}

const forArea = (f: ReviewFacts, area: TargetArea) => f.targets.filter((t) => t.area === area);

/** Estate status and a plain line, from approved documents when there are any, else from the typed-in statuses. */
export function estateSummary(e: EstateFacts): { status: AlignStatus; detail: string } {
  if (e.source === "documents") {
    const lines = e.adults.map((a) => {
      const will = a.will === "signed" ? `Will signed${a.willDate ? ` ${a.willDate}` : ""}` : a.will === "unsigned" ? "Will on file but not signed" : "no Will on file";
      return `${a.name}: ${will}; ${a.poa === "on_file" ? "Power of Attorney on file" : "no Power of Attorney on file"}`;
    });
    const trust = e.trusts > 0 ? ` ${plural(e.trusts, "trust document")} on file.` : "";
    const missingWill = e.adults.some((a) => a.will !== "signed");
    const missingPoa = e.adults.some((a) => a.poa !== "on_file");
    const status: AlignStatus = missingWill ? "Needs Attention" : missingPoa ? "Partial" : "Aligned";
    return { status, detail: `${lines.join(". ")}.${trust}` };
  }
  if (e.source === "manual" && e.manual) {
    const m = e.manual;
    const label = (v: string | null, noun: string) => (v ? `${noun} ${v}` : `${noun} not reviewed`);
    const will = m.will === "current", poa = m.poa === "current", ben = m.beneficiaries === "coordinated";
    const status: AlignStatus = will && poa && ben ? "Aligned" : m.will === "missing" || m.poa === "missing" ? "Needs Attention" : "Partial";
    return { status, detail: `${[label(m.will, "Will"), label(m.poa, "Power of Attorney"), label(m.beneficiaries, "Beneficiaries")].join("; ")} (entered by hand).` };
  }
  return { status: "Not Assessed", detail: "No estate documents have been read from the Vault yet." };
}

export function buildAlignmentCards(f: ReviewFacts): ReviewCard[] {
  const cards: ReviewCard[] = [];
  const b = f.balance;

  // Charter
  {
    const status: AlignStatus = f.charter.source === null ? "Needs Attention" : f.charter.ratified ? "Aligned" : "Partial";
    const detail = f.charter.source === null
      ? "No Charter is on file, so nothing written governs the system yet."
      : f.charter.ratified
        ? `Charter is ratified${f.charter.source === "contact" ? " (earlier-format Charter)" : f.charter.source === "vault" ? " (signed copy on file in the Vault)" : ""}${f.targets.length ? `; ${plural(f.targets.length, "numeric target")} read from it` : ""}.`
        : "A Charter exists but is not yet ratified.";
    cards.push({ key: "charter", label: "Sovereignty Charter", status, detail });
  }

  // Vineyard
  {
    const v = f.vineyard;
    const targets = forArea(f, "vineyard");
    let status: AlignStatus;
    let detail: string;
    if (v.accountCount === 0 && b.vineyard <= 0) { status = "Not Assessed"; detail = "No investment accounts are on record yet."; }
    else {
      const parts = [`${money(b.vineyard)} in the Vineyard${v.accountCount ? ` across ${plural(v.accountCount, "account")} with statements` : ""}`];
      if (b.holdingTank > 0) parts.push(`${money(b.holdingTank)} more in the Holding Tank`);
      if (v.accountCount > 0) parts.push(`${v.statementsRead}/${v.accountCount} read from statements this quarter`);
      if (v.staleCount > 0) parts.push(`${plural(v.staleCount, "account")} not updated recently`);
      if (v.withdrawalsYtd !== null) parts.push(`${money(v.withdrawalsYtd)} withdrawn this year`);
      if (v.statementsFiled === false) parts.push("no statements filed in the Vault");
      detail = `${parts.join("; ")}.`;
      status = v.accountCount > 0 && (v.statementsRead < v.accountCount || v.staleCount > 0 || v.statementsFiled === false) ? "Partial" : "Aligned";
    }
    cards.push({ key: "vineyard", label: "Vineyard", status: withTargets(status, targets), detail, targets });
  }

  // Liquidity Reserve
  {
    const targets = forArea(f, "liquidity");
    const parts = [`${money(b.liquidity)} in the Liquidity Reserve`];
    if (b.incomeFundsInLiquidity > 0) parts.push(`includes ${money(b.incomeFundsInLiquidity)} of income funds from the statements`);
    let status: AlignStatus;
    if (f.liquidity.setUp && f.liquidity.target !== null) {
      parts.push(`its target is ${money(f.liquidity.target)}`);
      status = b.liquidity >= f.liquidity.target ? "Aligned" : "Needs Attention";
    } else if (targets.length > 0) status = "Aligned"; // judged by the Charter targets below
    else if (b.liquidity > 0) { parts.push("no target is recorded to measure it against"); status = "Partial"; }
    else { parts.push("nothing is set aside and no target is recorded"); status = "Needs Attention"; }
    cards.push({ key: "liquidity", label: "Liquidity Reserve", status: withTargets(status, targets), detail: `${parts.join("; ")}.`, targets });
  }

  // Strategic Reserve
  {
    const s = f.strategic;
    const targets = forArea(f, "strategic");
    const parts = [`${money(b.strategic)} in the Strategic Reserve`];
    if (b.cashValue > 0) parts.push(`includes ${money(b.cashValue)} of insurance cash value`);
    let status: AlignStatus;
    if (s.policyCount === 0 && b.strategic <= 0) { status = "Not Assessed"; parts.push("no insurance policies are on record"); }
    else {
      if (s.policyCount > 0) parts.push(`${plural(s.policyCount, "policy", "policies")} with ${money(s.coverageTotal)} of coverage`);
      if (s.missingCoverageCount) parts.push(`${plural(s.missingCoverageCount, "policy", "policies")} missing a coverage amount`);
      if (s.missingBeneficiaryCount) parts.push(`${plural(s.missingBeneficiaryCount, "policy", "policies")} with no beneficiary recorded`);
      if (s.renewalsDueSoon) parts.push(`${s.renewalsDueSoon} renewing within 90 days`);
      if (s.documentsFiled === false) parts.push("no insurance documents in the Vault");
      status = s.missingCoverageCount || s.missingBeneficiaryCount || s.documentsFiled === false ? "Partial" : "Aligned";
    }
    cards.push({ key: "strategic", label: "Strategic Reserve", status: withTargets(status, targets), detail: `${parts.join("; ")}.`, targets });
  }

  // Philanthropic Trust
  {
    const targets = forArea(f, "philanthropic");
    const status: AlignStatus = b.philanthropic > 0 ? "Aligned" : targets.length > 0 ? "Aligned" : "Not Assessed";
    const detail = b.philanthropic > 0 ? `${money(b.philanthropic)} in the Philanthropic Trust.`
      : targets.length > 0 ? "Nothing is held in the Philanthropic Trust yet."
        : "Nothing is held in the Philanthropic Trust and the Charter sets no target for it.";
    cards.push({ key: "philanthropic", label: "Philanthropic Trust", status: withTargets(status, targets), detail, targets });
  }

  // Legacy Trust (real estate + estate documents)
  {
    const targets = forArea(f, "legacy");
    const estate = estateSummary(f.legacy.estate);
    const parts = [`${money(b.legacy)} in the Legacy Trust`];
    if (f.legacy.realEstate > 0) parts.push(`includes ${money(f.legacy.realEstate)} of real estate`);
    cards.push({
      key: "legacy", label: "Legacy Trust", status: withTargets(estate.status, targets),
      detail: `${parts.join("; ")}. Estate documents: ${estate.detail}`, targets,
    });
  }

  // Liabilities
  {
    const l = f.liabilities;
    const targets = forArea(f, "liabilities");
    const status: AlignStatus = l.overdueLoans > 0 ? "Needs Attention" : "Aligned";
    const detail = l.total + l.corporate === 0 ? "No liabilities are recorded."
      : `${money(l.total + l.corporate)} recorded${l.corporate ? ` (${money(l.total)} personal, ${money(l.corporate)} corporate)` : ""}${
        l.revolving && l.revolving.limit > 0 ? `; ${money(l.revolving.available)} of ${money(l.revolving.limit)} revolving credit available` : ""}${
        l.overdueLoans ? `; ${plural(l.overdueLoans, "intercompany loan")} overdue` : ""}.`;
    cards.push({ key: "liabilities", label: "Liabilities", status: withTargets(status, targets), detail, targets });
  }

  // Corporate governance (corporate-track households only)
  if (f.corporate) {
    const c = f.corporate;
    const bits: string[] = [];
    if (c.activeAssetRatio !== null) bits.push(`${Math.round(c.activeAssetRatio * 100)}% active assets (LCGE needs 90%)`);
    if (c.usaOnFile === false) bits.push("no Unanimous Shareholder Agreement on file");
    else if (c.usaStale) bits.push("Unanimous Shareholder Agreement is stale");
    if (c.sbdClawback && c.sbdClawback > 0) bits.push(`${money(c.sbdClawback)} of small-business deduction at risk`);
    const bad = (c.activeAssetRatio !== null && c.activeAssetRatio < 0.75) || c.usaOnFile === false || (c.sbdClawback ?? 0) > 0;
    const warn = c.usaStale === true || (c.activeAssetRatio !== null && c.activeAssetRatio < 0.9);
    cards.push({
      key: "corporate", label: "Corporate Governance",
      status: bad ? "Needs Attention" : warn ? "Partial" : "Aligned",
      detail: bits.length ? `${bits.join("; ")}.` : "No corporate governance exposure flagged.",
    });
  }

  return cards;
}

export function overallAlignment(cards: ReviewCard[]): { status: AlignStatus; attention: number; partial: number } {
  const attention = cards.filter((c) => c.status === "Needs Attention").length;
  const partial = cards.filter((c) => c.status === "Partial" || c.status === "Not Assessed").length;
  return { status: attention > 0 ? "Needs Attention" : partial > 0 ? "Partial" : "Aligned", attention, partial };
}

export interface Deltas { aum: number | null; netWorth: number | null; previousLabel: string | null }

/** Change since the previous review (null when there is nothing to compare against). */
export function computeDeltas(
  current: { aum: number; net_worth: number },
  previous: { aum?: number; net_worth?: number; label: string | null } | null,
): Deltas {
  if (!previous || typeof previous.aum !== "number") return { aum: null, netWorth: null, previousLabel: null };
  return {
    aum: Math.round(current.aum - previous.aum),
    netWorth: typeof previous.net_worth === "number" ? Math.round(current.net_worth - previous.net_worth) : null,
    previousLabel: previous.label,
  };
}

export type ReviewMode = "quarterly" | "survey";

/** Chartered (ratified Charter) households get the Quarterly Review; everyone else gets the Sovereignty Survey. */
export function reviewMode(charter: { source: "vault" | "household" | "contact" | null; ratified: boolean }): ReviewMode {
  return charter.source !== null && charter.ratified ? "quarterly" : "survey";
}

/**
 * Which areas have no records on file at all. A missing record is not the same as a real gap, so the
 * Survey shows this beside the cards ("not yet on file") instead of treating it as an exposure.
 */
export function dataCompleteness(f: ReviewFacts): { total: number; onFile: number; missing: string[] } {
  const checks: [string, boolean][] = [
    ["Investment accounts", f.vineyard.accountCount > 0 || f.balance.vineyard > 0],
    ["Insurance policies", f.strategic.policyCount > 0],
    ["Estate documents", f.legacy.estate.source !== "none"],
    ["Charter targets", f.targets.length > 0],
  ];
  if (f.statementData && f.statementData.accounts > 0) {
    checks.push(["Income funds read from statements", f.statementData.withIncomeFunds > 0]);
    checks.push(["Withdrawals read from statements", f.statementData.withWithdrawals > 0]);
  }
  const missing = checks.filter(([, ok]) => !ok).map(([name]) => name);
  return { total: checks.length, onFile: checks.length - missing.length, missing };
}
