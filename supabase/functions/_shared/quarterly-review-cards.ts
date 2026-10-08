// Pure logic for the Sovereignty Review's status cards. The cards follow the family's Vineyard and Storehouse
// framework, the same lines as the balance sheet: Charter, Vineyard, Liquidity Reserve, Strategic Reserve,
// Philanthropic Trust, Legacy Trust, Liabilities. Each card says three things:
//
//   Desired state  - what the Charter asks for in that area (its own numbers and words)
//   Current state  - what the balance sheet and the records show
//   Action required - what would bring the area into line, with the dollar amounts worked out HERE in code
//
// Every card reads the SAME allocated figures the balance sheet shows, so the two can never disagree. Statuses,
// figures and amounts are decided here, never by the AI; the AI only adds a sentence per area and the plan.
// Tax is deliberately not a card (a separate projection will cover it).

import type { TargetArea, TargetResult } from "./charter-targets.ts";

export type AlignStatus = "Aligned" | "Partial" | "Needs Attention" | "Not Assessed";

export interface ReviewCard {
  key: string;
  label: string;
  status: AlignStatus;
  /** The three parts, each a list of plain lines. */
  desired: string[];
  current: string[];
  actions: string[];
  /** The same three parts joined, for readers that want one string. */
  detail: string;
  /** Charter targets and rules for this area, already checked against the balance sheet. */
  targets?: TargetResult[];
  /** One sentence from the AI on whether the area meets the Charter's provisions (never changes the status). */
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
    /** Available credit staff assigned to the Strategic Reserve. Already inside `strategic` and `totalAssets`; offset by an equal undrawn-credit liability, so `netWorth` is unchanged. */
    creditCapacity?: number;
  };
  vineyard: {
    accountCount: number;          // accounts that issue a statement
    statementsRead: number;        // of those, read from a statement this quarter
    staleCount: number;            // read, but not updated within the freshness window
    statementsFiled: boolean | null;
    withdrawalsYtd: number | null; // spent / withdrawn so far this year (the harvest)
  };
  liquidity: { setUp: boolean; target: number | null };
  strategic: { policyCount: number; coverageTotal: number; missingCoverageCount: number; missingBeneficiaryCount: number; renewalsDueSoon: number; documentsFiled: boolean | null };
  legacy: { realEstate: number; estate: EstateFacts };
  liabilities: {
    total: number; corporate: number; overdueLoans: number;
    revolving?: { limit: number; available: number } | null;
    /** Yearly interest on liabilities that have a rate recorded, and how many have none. */
    rated?: { interest: number; unratedCount: number; unratedBalance: number } | null;
  };
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

// ---- Rebalancing --------------------------------------------------------

export type MoveArea = "vineyard" | "liquidity" | "strategic" | "philanthropic";
export interface Move { from: MoveArea; to: MoveArea; amount: number }

const AREA_NAME: Record<MoveArea, string> = {
  vineyard: "Vineyard", liquidity: "Liquidity Reserve", strategic: "Strategic Reserve", philanthropic: "Philanthropic Trust",
};
const SURPLUS_TOLERANCE = 0.1; // a reserve within 10% above its target is on target; beyond that the excess is moved

/**
 * Works out what to move between the reserves and the Vineyard so each reserve lands on its Charter balance target.
 * Reserves above target send their excess to reserves that are short, then to the Vineyard; a reserve still short
 * is topped up from the Vineyard. Legacy Trust is never a source (it is mostly real estate). Only checked balance
 * targets count; yearly figures and rules never move money.
 */
export function planRebalance(f: ReviewFacts): Move[] {
  const areas: Array<Exclude<MoveArea, "vineyard">> = ["liquidity", "strategic", "philanthropic"];
  const surplus: Array<{ area: MoveArea; amount: number }> = [];
  const short: Array<{ area: MoveArea; amount: number }> = [];
  for (const area of areas) {
    const t = f.targets.find((x) => x.area === area && x.gapAmount !== null && (x.status === "met" || x.status === "below" || x.status === "above"));
    if (!t || t.gapAmount === null) continue;
    // The reserve is measured with any available credit assigned to it, but only real money can be moved: credit is never a source.
    const credit = area === "strategic" ? f.balance.creditCapacity ?? 0 : 0;
    const balance = f.balance[area];
    const targetDollars = balance - t.gapAmount;
    if (t.gapAmount > 0 && targetDollars > 0 && t.gapAmount / targetDollars > SURPLUS_TOLERANCE) surplus.push({ area, amount: Math.min(t.gapAmount, Math.max(0, f.balance[area] - credit)) });
    else if (t.status === "below" && t.gapAmount < 0) short.push({ area, amount: -t.gapAmount });
  }
  const moves: Move[] = [];
  for (const s of short) {
    let need = s.amount;
    for (const src of surplus) {
      if (need <= 0) break;
      const take = Math.min(src.amount, need);
      if (take > 0) { moves.push({ from: src.area, to: s.area, amount: take }); src.amount -= take; need -= take; }
    }
    if (need > 0) moves.push({ from: "vineyard", to: s.area, amount: need });
  }
  for (const src of surplus) if (src.amount > 0) moves.push({ from: src.area, to: "vineyard", amount: src.amount });
  return moves;
}

const moveLines = (moves: Move[], area: MoveArea): string[] =>
  moves.filter((m) => m.from === area || m.to === area).map((m) =>
    m.from === area ? `Rebalance ${money(m.amount)} from the ${AREA_NAME[area]} to the ${AREA_NAME[m.to]}.`
      : m.from === "vineyard" ? `Move ${money(m.amount)} from the Vineyard to top up the ${AREA_NAME[area]}.`
        : `Receive ${money(m.amount)} from the ${AREA_NAME[m.from]}.`);

// ---- Cards --------------------------------------------------------------

const forArea = (f: ReviewFacts, area: TargetArea) => f.targets.filter((t) => t.area === area);

const isFlow = (t: TargetResult) => t.metric === "annual_amount" || t.metric === "monthly_amount";
const isRule = (t: TargetResult) => t.metric === "other" || t.area === "other";
const yearly = (t: TargetResult) => (t.value === null ? null : t.metric === "monthly_amount" ? t.value * 12 : t.value);

/** What the Charter asks for in an area: its balance targets and its yearly figures, in its own words. */
function desiredFor(f: ReviewFacts, area: TargetArea, extra: TargetResult[] = []): string[] {
  const lines: string[] = [];
  for (const t of [...forArea(f, area), ...extra]) {
    if (isRule(t) && area !== "legacy") continue; // rules are listed with the Charter / Legacy cards
    if (isFlow(t)) { const y = yearly(t); if (y !== null) lines.push(`${t.label}: ${money(y)} a year.`); }
    else if (t.status !== "info") lines.push(`${t.label}: ${t.targetText}.`);
    else lines.push(`${t.label}${t.quote ? ` — “${t.quote.length > 110 ? `${t.quote.slice(0, 107)}...` : t.quote}”` : ""}.`);
  }
  return lines.length ? lines : ["The Charter sets no target for this area."];
}

/** A target that is short of, or over, the Charter's limit makes the area Needs Attention. */
function withTargets(status: AlignStatus, targets: TargetResult[]): AlignStatus {
  return targets.some((t) => t.status === "below" || t.status === "above") ? "Needs Attention" : status;
}
/** Money that should move makes an otherwise-aligned area Partial. */
const withMoves = (status: AlignStatus, moves: Move[], area: MoveArea): AlignStatus =>
  status === "Aligned" && moves.some((m) => m.from === area || m.to === area) ? "Partial" : status;

/**
 * Builds the estate facts the Review and the Governance Audit both use: per adult, a signed Will and a Power of Attorney
 * read from documents approved in Glass-Box; with no documents, the hand-entered Stabilization Map statuses; else none.
 */
export function estateFactsFrom(
  contacts: Array<{ id: string; first_name: string | null; family_role: string | null }>,
  docs: Array<{ contact_id: string | null; document_type: string; signed: boolean | null; document_date: string | null }>,
  manual: { will: string | null; poa: string | null; beneficiaries: string | null } | null,
): EstateFacts {
  const adultRows = contacts.filter((c) => c.family_role === "head_of_family" || c.family_role === "spouse");
  const adults = adultRows.length ? adultRows : contacts.slice(0, 1);
  const estateAdults: EstateAdult[] = adults.map((a) => {
    const wills = docs.filter((d) => d.contact_id === a.id && d.document_type === "will");
    const signed = wills.find((d) => d.signed === true);
    return {
      name: a.first_name || "Member",
      will: signed ? "signed" : wills.length ? "unsigned" : "missing",
      willDate: signed?.document_date ?? null,
      poa: docs.some((d) => d.contact_id === a.id && d.document_type === "power_of_attorney") ? "on_file" : "missing",
    };
  });
  const hasManual = !!(manual && (manual.will || manual.poa || manual.beneficiaries));
  return {
    source: docs.length ? "documents" : hasManual ? "manual" : "none",
    adults: estateAdults, trusts: docs.filter((d) => d.document_type === "trust").length,
    manual: manual ?? { will: null, poa: null, beneficiaries: null },
  };
}

/** Estate status and a plain line, from approved documents when there are any, else from the typed-in statuses. */
export function estateSummary(e: EstateFacts): { status: AlignStatus; detail: string; actions: string[] } {
  if (e.source === "documents") {
    const lines = e.adults.map((a) => {
      const will = a.will === "signed" ? `Will signed${a.willDate ? ` ${a.willDate}` : ""}` : a.will === "unsigned" ? "Will on file but not signed" : "no Will on file";
      return `${a.name}: ${will}; ${a.poa === "on_file" ? "Power of Attorney on file" : "no Power of Attorney on file"}`;
    });
    const trust = e.trusts > 0 ? ` ${plural(e.trusts, "trust document")} on file.` : "";
    const actions: string[] = [];
    for (const a of e.adults) {
      if (a.will === "missing") actions.push(`Locate or draft ${a.name}'s Will.`);
      else if (a.will === "unsigned") actions.push(`Get ${a.name}'s Will signed (the copy on file is unsigned).`);
      if (a.poa === "missing") actions.push(`Locate or draft ${a.name}'s Power of Attorney.`);
    }
    const missingWill = e.adults.some((a) => a.will !== "signed");
    const missingPoa = e.adults.some((a) => a.poa !== "on_file");
    const status: AlignStatus = missingWill ? "Needs Attention" : missingPoa ? "Partial" : "Aligned";
    return { status, detail: `${lines.join(". ")}.${trust}`, actions };
  }
  if (e.source === "manual" && e.manual) {
    const m = e.manual;
    const label = (v: string | null, noun: string) => (v ? `${noun} ${v}` : `${noun} not reviewed`);
    const will = m.will === "current", poa = m.poa === "current", ben = m.beneficiaries === "coordinated";
    const status: AlignStatus = will && poa && ben ? "Aligned" : m.will === "missing" || m.poa === "missing" ? "Needs Attention" : "Partial";
    return {
      status, detail: `${[label(m.will, "Will"), label(m.poa, "Power of Attorney"), label(m.beneficiaries, "Beneficiaries")].join("; ")} (entered by hand).`,
      actions: status === "Aligned" ? [] : ["Run a Vault scan so the Will and Power of Attorney are read from the Estate folder."],
    };
  }
  return { status: "Not Assessed", detail: "No estate documents have been read from the Vault yet.", actions: ["Run a Vault scan so the Will and Power of Attorney are read from the Estate folder."] };
}

const NO_ACTION = "No action required.";

function make(key: string, label: string, status: AlignStatus, desired: string[], current: string[], actions: string[], targets?: TargetResult[]): ReviewCard {
  const acts = actions.length ? actions : [NO_ACTION];
  return { key, label, status, desired, current, actions: acts, targets, detail: `Desired: ${desired.join(" ")} Current: ${current.join(" ")} Action: ${acts.join(" ")}` };
}

export function buildAlignmentCards(f: ReviewFacts): ReviewCard[] {
  const cards: ReviewCard[] = [];
  const b = f.balance;
  const moves = planRebalance(f);
  const rules = forArea(f, "other");

  // Charter
  {
    const status: AlignStatus = f.charter.source === null ? "Needs Attention" : f.charter.ratified ? "Aligned" : "Partial";
    const desired = ["A ratified Sovereignty Charter that governs the whole system."];
    const current = f.charter.source === null
      ? ["No Charter is on file, so nothing written governs the system yet."]
      : [`Charter is ${f.charter.ratified ? "ratified" : "not yet ratified"}${f.charter.source === "contact" ? " (earlier-format Charter)" : f.charter.source === "vault" ? " (signed copy in the Vault)" : ""}; ${plural(f.targets.length, "numeric figure")} read from it.`];
    const actions = f.charter.source === null ? ["Draft and ratify the Charter."] : f.charter.ratified ? [] : ["Ratify the Charter."];
    // Charter rules that belong to no one area (waiting periods, review triggers) are listed for reference.
    for (const r of rules) desired.push(`${r.label}${r.quote ? ` — “${r.quote.length > 110 ? `${r.quote.slice(0, 107)}...` : r.quote}”` : ""}.`);
    cards.push(make("charter", "Sovereignty Charter", status, desired, current, actions, rules));
  }

  // Vineyard
  {
    const v = f.vineyard;
    const targets = forArea(f, "vineyard");
    // The Charter's yearly budget lines (lifestyle spending) are what the Vineyard has to fund.
    const budget = f.targets.filter((t) => t.area === "other" && isFlow(t));
    const desired = desiredFor(f, "vineyard", budget);
    const current: string[] = [];
    const actions: string[] = [];
    let status: AlignStatus;
    if (v.accountCount === 0 && b.vineyard <= 0) {
      status = "Not Assessed"; current.push("No investment accounts are on record yet.");
    } else {
      current.push(`${money(b.vineyard)} in the Vineyard${v.accountCount ? ` across ${plural(v.accountCount, "account")} with statements` : ""}${b.holdingTank > 0 ? `, plus ${money(b.holdingTank)} in the Holding Tank` : ""}.`);
      if (v.withdrawalsYtd !== null) current.push(`${money(v.withdrawalsYtd)} withdrawn so far this year.`);
      if (v.accountCount > 0) current.push(`${v.statementsRead}/${v.accountCount} accounts read from statements this quarter${v.staleCount ? `; ${plural(v.staleCount, "account")} not updated recently` : ""}.`);
      if (v.statementsFiled === false) current.push("No investment statements are filed in the Vault.");
      status = v.accountCount > 0 && (v.statementsRead < v.accountCount || v.staleCount > 0 || v.statementsFiled === false) ? "Partial" : "Aligned";
      if (v.accountCount > v.statementsRead) actions.push(`Run a Vault scan to read ${plural(v.accountCount - v.statementsRead, "more statement")}.`);
    }
    actions.unshift(...moveLines(moves, "vineyard"));
    cards.push(make("vineyard", "Vineyard", withMoves(withTargets(status, targets), moves, "vineyard"), desired, current, actions, [...targets, ...budget]));
  }

  // Liquidity Reserve
  {
    const targets = forArea(f, "liquidity");
    const desired = desiredFor(f, "liquidity");
    if (f.liquidity.setUp && f.liquidity.target !== null) desired.unshift(`Reserve target recorded on the Storehouse: ${money(f.liquidity.target)}.`);
    const current = [`${money(b.liquidity)} in the reserve${b.incomeFundsInLiquidity > 0 ? `, of which ${money(b.incomeFundsInLiquidity)} is income funds from the statements` : ""}.`];
    if (f.vineyard.withdrawalsYtd !== null) current.push(`${money(f.vineyard.withdrawalsYtd)} spent so far this year.`);
    let status: AlignStatus;
    const actions: string[] = [];
    if (f.liquidity.setUp && f.liquidity.target !== null) {
      status = b.liquidity >= f.liquidity.target ? "Aligned" : "Needs Attention";
      if (b.liquidity < f.liquidity.target) actions.push(`Add ${money(f.liquidity.target - b.liquidity)} to reach the ${money(f.liquidity.target)} target.`);
    } else if (targets.length > 0) status = "Aligned"; // judged by the Charter targets
    else if (b.liquidity > 0) { status = "Partial"; actions.push("Set a Liquidity Reserve target in the Charter so the reserve can be measured."); }
    else { status = "Needs Attention"; actions.push("Set aside a Liquidity Reserve and record its target."); }
    actions.unshift(...moveLines(moves, "liquidity"));
    cards.push(make("liquidity", "Liquidity Reserve", withMoves(withTargets(status, targets), moves, "liquidity"), desired, current, actions, targets));
  }

  // Strategic Reserve
  {
    const s = f.strategic;
    const targets = forArea(f, "strategic");
    const desired = desiredFor(f, "strategic");
    const credit = b.creditCapacity ?? 0;
    const parts = [b.cashValue > 0 ? `${money(b.cashValue)} is insurance cash value` : "", credit > 0 ? `${money(credit)} is available credit` : ""].filter(Boolean);
    const current = [`${money(b.strategic)} in the reserve${parts.length ? `, of which ${parts.join(" and ")}` : ""}.`];
    if (credit > 0) current.push(`The available credit is offset by an equal undrawn-credit line in liabilities, so Net Worth is unchanged.`);
    const actions: string[] = [];
    let status: AlignStatus;
    if (s.policyCount === 0 && b.strategic <= 0 && credit <= 0) { status = "Not Assessed"; current.push("No insurance policies are on record."); }
    else {
      if (s.policyCount > 0) current.push(`${plural(s.policyCount, "policy", "policies")} with ${money(s.coverageTotal)} of coverage.`);
      if (s.missingCoverageCount) actions.push(`Record the coverage amount on ${plural(s.missingCoverageCount, "policy", "policies")}.`);
      if (s.missingBeneficiaryCount) actions.push(`Record the beneficiary on ${plural(s.missingBeneficiaryCount, "policy", "policies")}.`);
      if (s.renewalsDueSoon) actions.push(`Review ${plural(s.renewalsDueSoon, "policy renewal")} due within 90 days.`);
      if (s.documentsFiled === false) actions.push("File the insurance documents in the Vault.");
      status = s.missingCoverageCount || s.missingBeneficiaryCount || s.documentsFiled === false ? "Partial" : "Aligned";
    }
    actions.unshift(...moveLines(moves, "strategic"));
    cards.push(make("strategic", "Strategic Reserve", withMoves(withTargets(status, targets), moves, "strategic"), desired, current, actions, targets));
  }

  // Philanthropic Trust
  {
    const targets = forArea(f, "philanthropic");
    const desired = desiredFor(f, "philanthropic");
    const current = [b.philanthropic > 0 ? `${money(b.philanthropic)} in the trust.` : "Nothing is held in the Philanthropic Trust."];
    const status: AlignStatus = b.philanthropic > 0 || targets.length > 0 ? "Aligned" : "Not Assessed";
    const actions = [...moveLines(moves, "philanthropic")];
    cards.push(make("philanthropic", "Philanthropic Trust", withMoves(withTargets(status, targets), moves, "philanthropic"), desired, current, actions, targets));
  }

  // Legacy Trust (real estate + estate documents)
  {
    const targets = forArea(f, "legacy");
    const estate = estateSummary(f.legacy.estate);
    const desired = ["A signed Will and Power of Attorney for each adult.", ...desiredFor(f, "legacy").filter((l) => !l.startsWith("The Charter sets no target"))];
    const current = [`${money(b.legacy)} in the Legacy Trust${f.legacy.realEstate > 0 ? `, of which ${money(f.legacy.realEstate)} is real estate` : ""}.`, `Estate documents: ${estate.detail}`];
    cards.push(make("legacy", "Legacy Trust", withTargets(estate.status, targets), desired, current, estate.actions, targets));
  }

  // Liabilities
  {
    const l = f.liabilities;
    const targets = forArea(f, "liabilities");
    const budgets = targets.filter((t) => isFlow(t));
    const desired = desiredFor(f, "liabilities");
    const total = l.total + l.corporate;
    const current: string[] = [];
    const actions: string[] = [];
    if (total === 0) current.push("No liabilities are recorded.");
    else {
      current.push(`${money(total)} recorded${l.corporate ? ` (${money(l.total)} personal, ${money(l.corporate)} corporate)` : ""}.`);
      if (l.revolving && l.revolving.limit > 0) current.push(`${money(l.revolving.available)} of ${money(l.revolving.limit)} revolving credit available.`);
      if (l.rated) {
        current.push(`About ${money(l.rated.interest)} a year in interest on the debt that has a rate recorded.`);
        if (l.rated.unratedCount > 0) actions.push(`Record the interest rate on ${plural(l.rated.unratedCount, "liability", "liabilities")} (${money(l.rated.unratedBalance)}) so the debt service can be compared with the Charter's budget.`);
        for (const bt of budgets) {
          const y = yearly(bt);
          if (y !== null && l.rated.unratedCount === 0 && l.rated.interest > y) actions.push(`Interest of about ${money(l.rated.interest)} a year exceeds the Charter's ${money(y)} budget by ${money(l.rated.interest - y)}: review paying down or refinancing.`);
        }
      } else if (total > 0) actions.push("Record the interest rate on each liability so the debt service can be compared with the Charter's budget.");
      if (l.overdueLoans) actions.push(`Resolve ${plural(l.overdueLoans, "overdue intercompany loan")}.`);
    }
    const status: AlignStatus = l.overdueLoans > 0 ? "Needs Attention" : "Aligned";
    cards.push(make("liabilities", "Liabilities", withTargets(status, targets), desired, current, actions, targets));
  }

  // Corporate governance (corporate-track households only)
  if (f.corporate) {
    const c = f.corporate;
    const current: string[] = [];
    const actions: string[] = [];
    if (c.activeAssetRatio !== null) { current.push(`${Math.round(c.activeAssetRatio * 100)}% active assets.`); if (c.activeAssetRatio < 0.9) actions.push("Purify passive assets to reach the 90% needed for the lifetime capital gains exemption."); }
    if (c.usaOnFile === false) { current.push("No Unanimous Shareholder Agreement on file."); actions.push("Put a Unanimous Shareholder Agreement in place."); }
    else if (c.usaStale) { current.push("Unanimous Shareholder Agreement is stale."); actions.push("Review the Unanimous Shareholder Agreement."); }
    if (c.sbdClawback && c.sbdClawback > 0) { current.push(`${money(c.sbdClawback)} of small-business deduction at risk.`); actions.push("Reduce passive income to protect the small-business deduction."); }
    const bad = (c.activeAssetRatio !== null && c.activeAssetRatio < 0.75) || c.usaOnFile === false || (c.sbdClawback ?? 0) > 0;
    const warn = c.usaStale === true || (c.activeAssetRatio !== null && c.activeAssetRatio < 0.9);
    cards.push(make("corporate", "Corporate Governance", bad ? "Needs Attention" : warn ? "Partial" : "Aligned",
      ["Active assets of at least 90%, a current shareholder agreement and no small-business-deduction clawback."], current.length ? current : ["No corporate governance exposure flagged."], actions));
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
