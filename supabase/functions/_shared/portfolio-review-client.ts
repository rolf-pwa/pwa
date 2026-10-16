// portfolio-review-client.ts: what a client sees of their Portfolio Review. Pure (no I/O) so it can be unit-tested.
//
// The staff pack is rich and blunt. The client's view is built from it in code, once, when Rolf publishes: figures are computed here, never
// by a model; wording is fixed; and the result is stored as a snapshot, so the client always sees exactly what was approved.

import type { Pack, PackAccountOut } from "./portfolio-review.ts";

export interface ClientIncludes { returns: boolean; mix: boolean; funds: boolean; reset: boolean; rebalancing: boolean }
export const ALL_INCLUDED: ClientIncludes = { returns: true, mix: true, funds: true, reset: true, rebalancing: true };

export interface ClientAccount { /** A short name for charts: the account type and the last four digits. */ label: string; name: string; owner: string | null; last4: string | null; value: number | null; changeYtd: number | null; ytdPct: number | null; oneYearPct: number | null; threeYearPct: number | null }
export type MixStatus = "inside" | "below" | "above" | "unknown";
export interface ClientView {
  /** Which page this is. Absent on views published before rebalances used the same page: treat as a review. */
  kind?: ViewKind;
  /** The Tier 1 rebalancing: the switches and the death benefit resets as items the client ticks and authorizes. */
  proposal?: ClientProposal | null;
  householdLabel: string;
  valuesAsOf: string | null;
  /** The statement date behind the fund detail, when older than the values. */
  holdingsAsOf?: string | null;
  note: string;
  summary: { value: number; changeYtd: number | null; ytdPct: number | null };
  /** The household's value over time, oldest first (empty when there is not enough history). */
  history: { date: string; value: number }[];
  accounts: ClientAccount[] | null;
  mix: { /** What the chart means for this household, in plain sentences built in code from the numbers. */ commentary: string[]; classes: { key: string; label: string; pct: number }[]; profileLabel: string | null; incomePct: number | null; equityPct: number | null; rangeMin: number | null; rangeMax: number | null; targetIncomePct: number | null; status: MixStatus; accounts: { name: string; last4: string | null; incomePct: number | null; status: MixStatus }[] } | null;
  funds: ClientFunds | null;
  /** When the accounts follow different models: one set per model, each against its own model. Replaces `funds`. */
  fundsSets?: (ClientFunds & { accounts: string[] })[] | null;
  /** What I propose to switch, by asset class, inside each account that is outside its profile's range. */
  rebalance?: { rows: { label: string; owner: string | null; direction: "to_income" | "to_equity"; amount: number; taxable: boolean }[]; hasTaxable: boolean } | null;
  reset: { rows: { name: string; owner: string | null; last4: string | null; fundValue: number; currentGuarantee: number; newGuarantee: number; lift: number }[]; totalLift: number; /** The death guarantee across these accounts today, and after the reset. */ totalNow: number; totalAfter: number } | null;
  disclosures: string[];
}

export interface ClientFunds { commentary: string[]; modelLabel: string; modelAsOf: string; heldInModelPct: number; rows: { name: string; modelPct: number | null; heldPct: number; inModel: boolean }[] }

export const DISCLOSURES = [
  "Returns are those reported by your custodian. Past performance does not guarantee future results.",
  "Segregated fund guarantees are subject to the terms of your contract. Withdrawals reduce the guaranteed amounts in proportion.",
  "This summary is prepared by ProsperWise from your latest statements and is for discussion with your advisor. It is not an offer or a recommendation to buy or sell anything.",
];

const last4 = (n: string | null) => (n ? n.replace(/[^0-9A-Za-z]/g, "").slice(-4) || null : null);
const round1 = (n: number) => Math.round(n * 10) / 10;
/** "iA Financial Group - IAG Savings and Retirement Plan - RRIF" becomes "RRIF", with the last four digits: "RRIF …0719". */
export function shortAccountName(name: string, number: string | null): string {
  const parts = String(name ?? "").split(" - ").map((s) => s.trim()).filter(Boolean);
  const base = parts.length ? parts[parts.length - 1] : "Account";
  const l4 = last4(number);
  return l4 ? `${base} …${l4}` : base;
}

const mixStatus = (d: PackAccountOut["drift"]): MixStatus => (d.status === "within" ? "inside" : d.status === "too_little_income" ? "below" : d.status === "too_much_income" ? "above" : "unknown");

const money0 = (n: number) => n.toLocaleString("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 });
const nameList = (names: string[], max = 3) => {
  const shown = names.slice(0, max);
  const rest = names.length - shown.length;
  const parts = rest > 0 ? [...shown, `${rest} other${rest === 1 ? "" : "s"}`] : shown;
  return parts.length <= 1 ? (parts[0] ?? "") : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
};
const accountName = (a: PackAccountOut) => shortAccountName(a.name, a.number);

/**
 * The sentences under the mix chart. Fixed templates filled from the numbers: nothing is written by a model, and nothing claims a cause
 * the data cannot show. Rolf reads these in the preview before he publishes.
 */
export function mixCommentary(pack: Pack): string[] {
  const d = pack.household.drift;
  const label = d.profileLabel ?? "profile";
  const out: string[] = [];
  const actual = d.actualIncomePct;
  if (actual === null || d.status === "no_data" || d.status === "no_target") return out;
  const byAccount = d.status === "by_account";
  const hasRange = d.rangeMin != null && d.rangeMax != null;
  if (byAccount) {
    const measured = pack.accounts.filter((a) => a.classTotals);
    const outside = measured.filter((a) => a.drift.status === "too_much_income" || a.drift.status === "too_little_income");
    out.push(`Your accounts follow different risk profiles, so each one is measured against its own. ${measured.length - outside.length} of your ${measured.length} accounts are inside their profile's range.`);
  } else if (hasRange) {
    const min = d.rangeMin as number, max = d.rangeMax as number;
    if (d.status === "within") {
      const pos = max > min ? (actual - min) / (max - min) : 0.5;
      out.push(`Your household asset mix falls within your ${label} risk profile, which holds ${min}–${max}% in income funds.${pos <= 0.2 ? " Your income allocation is toward the lower end of that range." : pos >= 0.8 ? " Your income allocation is toward the upper end of that range." : ""}`);
    } else {
      out.push(`Your household asset mix is outside your ${label} risk profile: income is ${actual}% against a range of ${min}–${max}%, so you hold ${d.status === "too_little_income" ? "more in equities" : "more in income funds"} than the profile calls for.`);
    }
  } else {
    out.push(`Your income allocation is ${actual}% against a target of ${d.targetIncomePct}%.`);
  }
  const heavyEquity = pack.accounts.filter((a) => a.classTotals && a.drift.status === "too_little_income");
  const heavyIncome = pack.accounts.filter((a) => a.classTotals && a.drift.status === "too_much_income");
  const total = pack.accounts.filter((a) => a.classTotals).length;
  const rising = (pack.household.valueWeightedYtd ?? 0) >= 3;
  if (heavyEquity.length) out.push(`${heavyEquity.length} of your ${total} accounts hold more in equities than your profile calls for (${nameList(heavyEquity.map(accountName))}).${rising ? " Equity funds grow faster than income funds when markets rise, which can move an account away from its profile." : ""}`);
  if (heavyIncome.length) out.push(`${heavyIncome.length} of your ${total} accounts hold more in income funds than your profile calls for (${nameList(heavyIncome.map(accountName))}).`);
  const off = [...heavyEquity, ...heavyIncome];
  if (off.length) out.push(`I recommend rebalancing ${off.length === 1 ? "this account" : "these accounts"} back to ${byAccount ? "its own" : `your ${label}`} profile. I will take you through the details at our meeting.`);
  else if (byAccount) out.push("Every account is inside its own profile's range, so no change is needed to your mix at this time. The funds comparison below shows where a closer match to our model portfolios is possible.");
  else if (d.status === "within") out.push("No change is needed to your mix at this time.");
  else out.push(`I recommend rebalancing your portfolio back to your ${label} profile. I will take you through the details at our meeting.`);
  return out;
}

/** The sentences under the funds-against-the-model bars. */
export function fundsCommentary(mc: NonNullable<Pack["household"]["modelComparison"]>): string[] {
  const label = mc.modelLabel;
  const off = mc.rows.filter((r) => !r.inModel).map((r) => r.name);
  const roughly = Math.round(mc.moveValue / 100) * 100;
  if (mc.offModelPct > 0) {
    return [
      `${round1(mc.offModelPct)}% of your portfolio is held in funds outside our ${label} model portfolio, including ${nameList(off)}.`,
      `I recommend rebalancing the portfolio to the model. Matching it would move about ${money0(roughly)} (${round1(mc.activeSharePct)}% of your portfolio). I will take you through the details at our meeting.`,
    ];
  }
  if (mc.activeSharePct >= 5) return [`All of your funds are in our ${label} model portfolio, but they are held in different proportions. Matching the model would move about ${round1(mc.activeSharePct)}% of your portfolio, and I recommend bringing them back into line.`];
  return [`Your funds line up closely with our ${label} model portfolio.`];
}

/**
 * "review" is the Portfolio Review (Tier 2: the proposal is shown for discussion at the meeting). "rebalance" is the Tier 1 rebalancing: the same
 * page and the same pack, but the client sees only the funds against the model, the death benefit reset and the proposal, and the proposal is
 * theirs to tick and authorize.
 */
export type ViewKind = "review" | "rebalance";
export const REBALANCE_SECTIONS: ClientIncludes = { returns: false, mix: false, funds: true, reset: true, rebalancing: true };

/** The advisor's own wording for the shaded commentary boxes, replacing the suggested text. Paragraphs are separated by a blank line. */
export interface Narratives { mix?: string | null; funds?: string | null }
export const MAX_NARRATIVE = 2000;
/** Splits the advisor's text into paragraphs, trimmed and capped. An empty text means "use the suggested wording". */
export function narrativeParagraphs(text: string | null | undefined): string[] | null {
  const t = String(text ?? "").slice(0, MAX_NARRATIVE).split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  return t.length ? t : null;
}

const toClientFunds = (mc: NonNullable<Pack["household"]["modelComparison"]>, commentary: string[]): ClientFunds => ({
  commentary, modelLabel: mc.modelLabel, modelAsOf: mc.modelAsOf, heldInModelPct: round1(100 - mc.offModelPct),
  rows: mc.rows.map((r) => ({ name: r.name, modelPct: r.modelPct, heldPct: r.actualPct, inModel: r.inModel })),
});

export function buildClientView(pack: Pack, includesIn: ClientIncludes, note: string, householdLabel: string, kind: ViewKind = "review", narratives: Narratives = {}): ClientView {
  // A rebalance never shows the values and the mix; the three other sections can still be switched off.
  const includes: ClientIncludes = kind === "rebalance" ? { ...REBALANCE_SECTIONS, funds: includesIn.funds, reset: includesIn.reset, rebalancing: includesIn.rebalancing } : includesIn;
  const h = pack.household;
  const covered = h.classTotals.income + h.classTotals.canadian_equity + h.classTotals.us_intl_equity + h.classTotals.equity_other;
  const equity = covered > 0 ? 100 - round1((h.classTotals.income / covered) * 100) : null;
  const mc = h.modelComparison;
  return {
    kind,
    householdLabel,
    valuesAsOf: pack.asOf,
    holdingsAsOf: pack.holdings?.asOf ?? null,
    note: note.trim(),
    summary: { value: pack.totalValue, changeYtd: h.changeYtd, ytdPct: h.valueWeightedYtd },
    history: pack.history.length >= 2 ? pack.history : [],
    accounts: includes.returns ? pack.accounts.map((a) => ({ label: shortAccountName(a.name, a.number), name: a.name, owner: a.owner, last4: last4(a.number), value: a.value, changeYtd: a.changeYtd, ytdPct: a.returns.ytd, oneYearPct: a.returns.oneYear, threeYearPct: a.returns.threeYear })) : null,
    mix: includes.mix && h.drift.status !== "no_data"
      ? {
        commentary: narrativeParagraphs(narratives.mix) ?? mixCommentary(pack),
        classes: [
          { key: "income", label: "Income", pct: covered > 0 ? round1((h.classTotals.income / covered) * 100) : 0 },
          { key: "canadian", label: "Canadian equity", pct: covered > 0 ? round1((h.classTotals.canadian_equity / covered) * 100) : 0 },
          { key: "global", label: "U.S. and international equity", pct: covered > 0 ? round1((h.classTotals.us_intl_equity / covered) * 100) : 0 },
          { key: "other", label: "Other equity", pct: covered > 0 ? round1((h.classTotals.equity_other / covered) * 100) : 0 },
        ].filter((c) => c.pct > 0),
        profileLabel: h.drift.profileLabel ?? null, incomePct: h.drift.actualIncomePct, equityPct: equity, rangeMin: h.drift.rangeMin ?? null, rangeMax: h.drift.rangeMax ?? null, targetIncomePct: h.drift.status === "by_account" ? null : h.drift.targetIncomePct, status: mixStatus(h.drift),
        accounts: pack.accounts.filter((a) => a.classTotals).map((a) => ({ name: a.name, last4: last4(a.number), incomePct: a.incomePct, status: mixStatus(a.drift) })),
      }
      : null,
    funds: includes.funds && mc ? toClientFunds(mc, narrativeParagraphs(narratives.funds) ?? fundsCommentary(mc)) : null,
    fundsSets: includes.funds && !mc && h.modelComparisons?.length
      ? h.modelComparisons.map((m, i) => ({
        ...toClientFunds(m, i === 0 ? narrativeParagraphs(narratives.funds) ?? fundsCommentary(m) : fundsCommentary(m)),
        accounts: pack.accounts.filter((a) => a.modelComparison?.modelKey === m.modelKey).map(accountName),
      }))
      : null,
    proposal: kind === "rebalance" && includes.rebalancing ? buildClientProposal(pack) : null,
    rebalance: kind === "review" && includes.rebalancing && pack.rebalancing.rows.some((r) => r.outsideRange && r.direction !== "none")
      ? (() => {
        const rows = pack.rebalancing.rows.filter((r) => r.outsideRange && r.direction !== "none");
        return { rows: rows.map((r) => ({ label: shortAccountName(r.name, r.number), owner: r.owner, direction: r.direction as "to_income" | "to_equity", amount: Math.round(r.amount / 100) * 100, taxable: r.taxable })), hasTaxable: rows.some((r) => r.taxable) };
      })()
      : null,
    reset: includes.reset && pack.resets.toReset > 0
      ? {
        rows: pack.resets.rows.filter((r) => r.status === "reset").map((r) => ({ name: r.name, owner: r.owner, last4: last4(r.number), fundValue: r.fundValue as number, currentGuarantee: r.deathGuarantee as number, newGuarantee: r.fundValue as number, lift: r.room as number })),
        totalLift: pack.resets.totalRoom,
        totalNow: Math.round(pack.resets.rows.filter((r) => r.status === "reset").reduce((n, r) => n + (r.deathGuarantee ?? 0), 0)),
        totalAfter: Math.round(pack.resets.rows.filter((r) => r.status === "reset").reduce((n, r) => n + (r.fundValue ?? 0), 0)),
      }
      : null,
    disclosures: DISCLOSURES,
  };
}

/** Georgia's note that a review is ready: names nothing about the figures. */
export function portfolioReviewReadyEmail(firstName: string, portalUrl: string, fromLine: string): { subject: string; html: string } {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return {
    subject: "Your Portfolio Review is ready",
    html: `
    <div style="font-family:'DM Sans',sans-serif;color:#334155;max-width:520px;margin:0 auto;">
      <p style="font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:#94a3b8;">Sovereignty Operating System™</p>
      <p style="font-size:14px;line-height:1.6;">Hi ${esc(firstName || "there")},</p>
      <p style="font-size:14px;line-height:1.6;">Rolf has prepared your Portfolio Review. You can read it in your portal whenever suits you, ahead of your meeting.</p>
      <p style="margin:20px 0;"><a href="${portalUrl}" style="background:#1e293b;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:6px;font-size:14px;">Open your portal</a></p>
      <p style="font-size:13px;line-height:1.6;color:#64748b;">${fromLine}</p>
      <p style="font-size:14px;line-height:1.6;margin-top:24px;">Georgia<br/><span style="font-size:12px;color:#94a3b8;">AI Assistant, ProsperWise</span></p>
    </div>`.trim(),
  };
}

// ───── The Tier 1 rebalancing proposal ─────
// What a Tier 1 household reviews and authorizes in its portal: the switches by asset class (accounts outside their profile's range) and the
// death benefit resets, each as an item the client acknowledges. Built from the pack when Rolf publishes, and frozen with the rebalancing.

export interface ProposalSwitch { id: string; label: string; owner: string | null; /** The contact who owns the account: only they authorize changes to it. */ ownerId?: string | null; direction: "to_income" | "to_equity"; /** What the client sees, rounded to $100. */ amount: number; /** The pack's figure to the dollar, for Rolf's task. */ exactAmount?: number; /** True when the account is inside its range but off the model's mix: the switch brings it back to the model. */ toModel?: boolean; taxable: boolean; /** Estimated capital gain (negative: loss) from this switch, to the dollar, from the account's book value. Null when not known. */ estGain?: number | null }
export interface ProposalReset { id: string; label: string; owner: string | null; ownerId?: string | null; currentGuarantee: number; newGuarantee: number; lift: number }
export interface ClientProposal { switches: ProposalSwitch[]; resets: ProposalReset[]; totalLift: number; totalNow: number; totalAfter: number; hasTaxable: boolean }
export type ProposalItem = (ProposalSwitch & { kind: "switch" }) | (ProposalReset & { kind: "reset" });

export function buildClientProposal(pack: Pack): ClientProposal | null {
  // A rebalancing brings every account back to its model: switches outside the range are needed, and any account off the model's mix by
  // more than the tolerance is brought back too (when the switch is worth at least $100 after rounding).
  const sw = pack.rebalancing.rows.filter((r) => r.direction !== "none" && (r.outsideRange || Math.round(r.amount / 100) * 100 >= 100));
  const rs = pack.resets.rows.filter((r) => r.status === "reset");
  if (!sw.length && !rs.length) return null;
  return {
    switches: sw.map((r) => ({ id: `switch:${r.accountId}`, label: shortAccountName(r.name, r.number), owner: r.owner, ownerId: r.ownerId ?? null, direction: r.direction as "to_income" | "to_equity", amount: Math.round(r.amount / 100) * 100, exactAmount: Math.round(r.amount), toModel: !r.outsideRange, taxable: r.taxable, estGain: r.estGain ?? null })),
    resets: rs.map((r) => ({ id: `reset:${r.accountId}`, label: shortAccountName(r.name, r.number), owner: r.owner, ownerId: r.ownerId ?? null, currentGuarantee: r.deathGuarantee as number, newGuarantee: r.fundValue as number, lift: r.room as number })),
    totalLift: Math.round(rs.reduce((n, r) => n + (r.room ?? 0), 0)),
    totalNow: Math.round(rs.reduce((n, r) => n + (r.deathGuarantee ?? 0), 0)),
    totalAfter: Math.round(rs.reduce((n, r) => n + (r.fundValue ?? 0), 0)),
    hasTaxable: sw.some((r) => r.taxable),
  };
}

export const proposalItems = (p: ClientProposal | null | undefined): ProposalItem[] =>
  p ? [...p.switches.map((s) => ({ ...s, kind: "switch" as const })), ...p.resets.map((r) => ({ ...r, kind: "reset" as const }))] : [];

/**
 * Each person authorizes the changes to the accounts they own, from their own portal login. A proposal frozen before owners were recorded has no
 * owner ids on its items: then every item belongs to whoever is signed in (as it did before).
 */
export function itemsOwnedBy(p: ClientProposal | null | undefined, contactId: string): ProposalItem[] {
  const all = proposalItems(p);
  if (all.every((i) => !i.ownerId)) return all;
  return all.filter((i) => i.ownerId === contactId);
}

/** Everything in the proposal has been authorized by its owners. */
export const proposalFullyAuthorized = (p: ClientProposal | null | undefined, authorizedIds: string[]): boolean => {
  const all = proposalItems(p);
  return all.length > 0 && all.every((i) => authorizedIds.includes(i.id));
};

/**
 * Can this signed-in person authorize these items? They must tick every change to their own accounts that is still open, and nothing that is
 * not theirs: a spouse authorizes their own changes separately, from their own portal.
 */
export function checkOwnAcknowledged(p: ClientProposal | null | undefined, contactId: string, alreadyAuthorized: string[], itemIds: string[]): { ok: true; items: ProposalItem[] } | { ok: false; error: string } {
  const mine = itemsOwnedBy(p, contactId);
  const open = mine.filter((i) => !alreadyAuthorized.includes(i.id));
  if (!mine.length) return { ok: false, error: "There are no changes to your accounts to authorize. Each person authorizes the changes to their own accounts." };
  if (!open.length) return { ok: false, error: "You have already authorized your changes." };
  const ids = new Set(itemIds);
  if (itemIds.some((id) => !mine.some((i) => i.id === id))) return { ok: false, error: "You can only authorize changes to your own accounts. The other account holder authorizes theirs from their own portal." };
  if (open.some((i) => !ids.has(i.id))) return { ok: false, error: "Tick every change you have reviewed before authorizing, or ask to talk it through." };
  return { ok: true, items: open };
}

/** A rebalancing is authorized as a whole: every item in the proposal must be acknowledged, and nothing that is not in it. */
export function checkAllAcknowledged(p: ClientProposal | null | undefined, itemIds: string[]): { ok: true; items: ProposalItem[] } | { ok: false; error: string } {
  const items = proposalItems(p);
  const ids = new Set(itemIds);
  if (!items.length) return { ok: true, items };
  if (itemIds.some((id) => !items.some((i) => i.id === id))) return { ok: false, error: "That item is not part of this rebalancing." };
  if (items.some((i) => !ids.has(i.id))) return { ok: false, error: "Tick every change you have reviewed before authorizing, or ask to talk it through." };
  return { ok: true, items };
}

/** Rolf's wording for the estimated gain on a taxable switch. */
export const gainPhrase = (g: number | null | undefined): string =>
  g === null || g === undefined ? "check the gain first" : `estimated ${g < 0 ? "loss" : "gain"} about $${Math.abs(Math.round(g)).toLocaleString("en-CA")}, check it with the client first`;

/**
 * A starting note for the rebalancing, written for Rolf to edit before he publishes: the estimated capital gain on each switch in a
 * non-registered account. Empty when there is nothing taxable to say.
 */
export function suggestedRebalanceNote(p: ClientProposal | null | undefined): string {
  const taxable = (p?.switches ?? []).filter((s) => s.taxable && s.estGain !== null && s.estGain !== undefined);
  if (!taxable.length) return "";
  const m = (n: number) => `$${Math.abs(Math.round(n / 100) * 100).toLocaleString("en-CA")}`;
  const lines = taxable.map((s) => `${s.label}${s.owner ? ` (${s.owner.split(" ")[0]})` : ""}: ${(s.estGain as number) < 0 ? "an estimated loss" : "an estimated capital gain"} of about ${m(s.estGain as number)}`);
  return `Switching in a non-registered account can realise a capital gain. My estimate, from the account's book value and the share being switched: ${lines.join("; ")}. I will go over this with you before anything is done.`;
}

export const describeProposalItem = (i: ProposalItem): string => {
  const m = (n: number) => `$${Math.round(n).toLocaleString("en-CA")}`;
  return i.kind === "switch"
    ? `${i.label}${i.owner ? ` (${i.owner})` : ""}: switch about ${m(i.amount)} ${i.direction === "to_income" ? "from equity into income funds" : "from income into equity funds"}${i.taxable ? ` [TAXABLE: ${gainPhrase(i.estGain)}]` : ""}`
    : `${i.label}${i.owner ? ` (${i.owner})` : ""}: reset the death benefit guarantee from ${m(i.currentGuarantee)} to about ${m(i.newGuarantee)}`;
};

// ───── Rolf's task to carry out an authorized rebalancing ─────

export interface RebalanceTaskPlan { description: string; subtasks: { title: string; description: string }[] }
const dollars = (n: number) => `$${Math.round(n).toLocaleString("en-CA")}`;
const first = (name: string | null) => (name ? name.split(" ")[0] : null);
const itemAccountKey = (id: string) => id.split(":")[1] ?? id;
const itemAction = (i: ProposalItem) => i.kind === "switch"
  ? `switch ${dollars(i.exactAmount ?? i.amount)} ${i.direction === "to_income" ? "from equity into income funds" : "from income into equity funds"}`
  : `reset the death benefit guarantee from ${dollars(i.currentGuarantee)} to ${dollars(i.newGuarantee)} (up ${dollars(i.lift)})`;

/**
 * The main task grouped by account (the switch and the reset for an account are done together on the iA advisor site) with the pack's exact
 * figures and a link to the pack, plus one subtask per authorized item to check off as each is done.
 */
export function rebalanceTaskPlan(items: ProposalItem[], opts: { clientName: string; label: string; today: string; packUrl: string | null; stored?: string }): RebalanceTaskPlan {
  const groups = new Map<string, ProposalItem[]>();
  for (const i of items) { const k = itemAccountKey(i.id); groups.set(k, [...(groups.get(k) ?? []), i]); }
  const lines: string[] = [];
  for (const [, g] of groups) {
    lines.push(`${g[0].label}${g[0].owner ? ` (${first(g[0].owner)})` : ""}${g.some((i) => i.kind === "switch" && i.taxable) ? `  [TAXABLE: ${gainPhrase((g.find((x) => x.kind === "switch") as ProposalSwitch | undefined)?.estGain)}]` : ""}`);
    for (const i of g) lines.push(`  - ${itemAction(i).replace(/^./, (c) => c.toUpperCase())}`);
  }
  const description = [
    `${opts.clientName} reviewed the ${opts.label} rebalancing you published and authorized every change below in the portal on ${opts.today}.`,
    opts.packUrl ? `Advisor pack: ${opts.packUrl}` : "",
    "",
    "Confirm the amounts with them first, as they move with markets. Do the switches and resets on the iA advisor site, check off each subtask as you go, then mark the rebalancing done on Georgia Reviews so the family is told. The figures are to the dollar as of the day you published; the client saw them rounded.",
    "",
    ...lines,
    "",
    opts.stored ?? "The authorization, with the exact wording they agreed to and the items as they saw them, is stored with the family's records.",
  ].filter((l, idx, a) => !(l === "" && a[idx - 1] === "")).join("\n");
  const subtasks = items.map((i) => ({
    title: `${i.label}${i.owner ? ` (${first(i.owner)})` : ""}: ${itemAction(i)}`,
    description: i.kind === "switch" && i.taxable ? `Taxable account: ${gainPhrase(i.estGain)}.` : "Authorized by the client in the portal. Check this off when it is done.",
  }));
  return { description, subtasks };
}
