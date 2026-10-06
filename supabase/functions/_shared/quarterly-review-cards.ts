// Pure logic for the Quarterly Review: turns already-gathered facts into alignment cards (status +
// plain detail), a quarter label and quarter-over-quarter changes. No I/O, so it is unit-tested.
// Statuses and figures are decided here, never by the AI; the AI only writes the narrative.

export type AlignStatus = "Aligned" | "Partial" | "Needs Attention" | "Not Assessed";

export interface ReviewCard {
  key: string;
  label: string;
  status: AlignStatus;
  detail: string;
}

export interface ReviewFacts {
  charter: { source: "household" | "contact" | null; ratified: boolean; hasVision: boolean };
  investments: {
    accountCount: number; total: number; trackedCount: number; negativeCount: number;
    staleCount: number;           // tracked, but last snapshot older than the freshness window
    statementsFiled: boolean | null; // Vault "Investment Statements" folder has documents (null = unknown)
  };
  storehouses: { count: number; aligned: number; pending: number; misaligned: number; underfunded: number; missingLanes: number[] };
  insurance: { policyCount: number; coverageTotal: number; missingCoverageCount: number; missingBeneficiaryCount: number; renewalsDueSoon: number; documentsFiled: boolean | null };
  estate: { will: string | null; poa: string | null; beneficiaries: string | null; documentsFiled: boolean | null };
  tax: { documentsFiled: boolean | null };
  liabilities: { personal: number; corporate: number; overdueLoans: number };
  documents: { percent: number; satisfied: number; total: number; missing: string[] };
  corporate?: { activeAssetRatio: number | null; usaOnFile: boolean | null; usaStale: boolean | null; sbdClawback: number | null } | null;
}

const money = (n: number) => `$${Math.round(n).toLocaleString("en-CA")}`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Calendar quarter the review is conducted in, e.g. "2026 Q4". */
export function quarterLabel(d: Date): string {
  return `${d.getUTCFullYear()} Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
}

export function buildAlignmentCards(f: ReviewFacts): ReviewCard[] {
  const cards: ReviewCard[] = [];

  // Charter
  {
    const status: AlignStatus = f.charter.source === null ? "Needs Attention" : f.charter.ratified ? "Aligned" : "Partial";
    const detail = f.charter.source === null
      ? "No Charter is on file, so nothing written governs the system yet."
      : f.charter.ratified
        ? `Charter is ratified${f.charter.source === "contact" ? " (earlier-format Charter)" : ""}.`
        : "A Charter exists but is not yet ratified.";
    cards.push({ key: "charter", label: "Sovereignty Charter", status, detail });
  }

  // Investments
  {
    const i = f.investments;
    let status: AlignStatus;
    let detail: string;
    if (i.accountCount === 0) { status = "Needs Attention"; detail = "No investment accounts are on record."; }
    else {
      const parts = [`${plural(i.accountCount, "account")} totalling ${money(i.total)}`];
      parts.push(`${i.trackedCount}/${i.accountCount} with harvest tracking`);
      if (i.staleCount > 0) parts.push(`${plural(i.staleCount, "account")} not updated this quarter`);
      if (i.negativeCount > 0) parts.push(`${plural(i.negativeCount, "account")} with a negative harvest to review`);
      if (i.statementsFiled === false) parts.push("no statements filed in the Vault");
      detail = `${parts.join("; ")}.`;
      status = i.trackedCount < i.accountCount || i.staleCount > 0 || i.negativeCount > 0 || i.statementsFiled === false
        ? (i.trackedCount === 0 ? "Needs Attention" : "Partial") : "Aligned";
    }
    cards.push({ key: "investments", label: "Investments", status, detail });
  }

  // Storehouse reserves
  {
    const s = f.storehouses;
    let status: AlignStatus;
    let detail: string;
    if (s.count === 0) { status = "Needs Attention"; detail = "No Storehouse reserves are set up."; }
    else {
      const parts = [`${plural(s.count, "reserve")}: ${s.aligned} aligned`];
      if (s.pending) parts.push(`${s.pending} pending review`);
      if (s.misaligned) parts.push(`${s.misaligned} misaligned`);
      if (s.underfunded) parts.push(`${s.underfunded} below target`);
      if (s.missingLanes.length) parts.push(`missing lane${s.missingLanes.length > 1 ? "s" : ""} ${s.missingLanes.map((n) => `#${n}`).join(", ")}`);
      detail = `${parts.join("; ")}.`;
      status = s.misaligned > 0 || s.underfunded > 0 ? "Needs Attention" : s.pending > 0 || s.missingLanes.length > 0 ? "Partial" : "Aligned";
    }
    cards.push({ key: "storehouse", label: "Storehouse Reserves", status, detail });
  }

  // Insurance
  {
    const n = f.insurance;
    let status: AlignStatus;
    let detail: string;
    if (n.policyCount === 0) { status = "Not Assessed"; detail = "No insurance policies are on record."; }
    else {
      const parts = [`${plural(n.policyCount, "policy", "policies")}, ${money(n.coverageTotal)} of coverage`];
      if (n.missingCoverageCount) parts.push(`${plural(n.missingCoverageCount, "policy", "policies")} missing a coverage amount`);
      if (n.missingBeneficiaryCount) parts.push(`${plural(n.missingBeneficiaryCount, "policy", "policies")} with no beneficiary recorded`);
      if (n.renewalsDueSoon) parts.push(`${n.renewalsDueSoon} renewing within 90 days`);
      if (n.documentsFiled === false) parts.push("no insurance documents in the Vault");
      detail = `${parts.join("; ")}.`;
      status = n.missingCoverageCount || n.missingBeneficiaryCount || n.documentsFiled === false ? "Partial" : "Aligned";
    }
    cards.push({ key: "insurance", label: "Insurance", status, detail });
  }

  // Estate
  {
    const e = f.estate;
    const known = [e.will, e.poa, e.beneficiaries].filter(Boolean).length;
    const will = e.will === "current", poa = e.poa === "current", ben = e.beneficiaries === "coordinated";
    let status: AlignStatus;
    if (known === 0) status = e.documentsFiled ? "Partial" : "Not Assessed";
    else status = will && poa && ben ? "Aligned" : e.will === "missing" || e.poa === "missing" ? "Needs Attention" : "Partial";
    const label = (v: string | null, noun: string) => (v ? `${noun} ${v}` : `${noun} not reviewed`);
    const detail = `${[label(e.will, "Will"), label(e.poa, "Power of Attorney"), label(e.beneficiaries, "Beneficiaries")].join("; ")}${
      e.documentsFiled === false ? "; no estate documents in the Vault" : ""}.`;
    cards.push({ key: "estate", label: "Estate", status, detail });
  }

  // Tax
  {
    const t = f.tax;
    const status: AlignStatus = t.documentsFiled === null ? "Not Assessed" : t.documentsFiled ? "Aligned" : "Needs Attention";
    const detail = t.documentsFiled === null ? "Tax documents could not be checked this quarter."
      : t.documentsFiled ? "Tax documents are filed in the Vault." : "No tax documents are filed in the Vault.";
    cards.push({ key: "tax", label: "Tax", status, detail });
  }

  // Liabilities
  {
    const l = f.liabilities;
    const total = l.personal + l.corporate;
    const status: AlignStatus = l.overdueLoans > 0 ? "Needs Attention" : "Aligned";
    const detail = total === 0 ? "No liabilities are recorded."
      : `${money(total)} recorded${l.corporate ? ` (${money(l.personal)} personal, ${money(l.corporate)} corporate)` : ""}${
        l.overdueLoans ? `; ${plural(l.overdueLoans, "intercompany loan")} overdue` : ""}.`;
    cards.push({ key: "liabilities", label: "Liabilities", status, detail });
  }

  // Document readiness
  {
    const d = f.documents;
    const status: AlignStatus = d.total === 0 ? "Not Assessed" : d.percent >= 100 ? "Aligned" : d.percent > 0 ? "Partial" : "Needs Attention";
    const detail = d.total === 0 ? "Document readiness has not been assessed."
      : `${d.satisfied}/${d.total} required document categories filed${d.missing.length ? `; missing: ${d.missing.slice(0, 3).join(", ")}` : ""}.`;
    cards.push({ key: "documents", label: "Document Readiness", status, detail });
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
