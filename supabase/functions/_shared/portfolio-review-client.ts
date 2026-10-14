// portfolio-review-client.ts: what a client sees of their Portfolio Review. Pure (no I/O) so it can be unit-tested.
//
// The staff pack is rich and blunt. The client's view is built from it in code, once, when Rolf publishes: figures are computed here, never
// by a model; wording is fixed; and the result is stored as a snapshot, so the client always sees exactly what was approved.

import type { Pack, PackAccountOut } from "./portfolio-review.ts";

export interface ClientIncludes { returns: boolean; mix: boolean; funds: boolean; reset: boolean }
export const ALL_INCLUDED: ClientIncludes = { returns: true, mix: true, funds: true, reset: true };

export interface ClientAccount { name: string; owner: string | null; last4: string | null; value: number | null; changeYtd: number | null; ytdPct: number | null; oneYearPct: number | null; threeYearPct: number | null }
export type MixStatus = "inside" | "below" | "above" | "unknown";
export interface ClientView {
  householdLabel: string;
  valuesAsOf: string | null;
  note: string;
  summary: { value: number; changeYtd: number | null; ytdPct: number | null };
  accounts: ClientAccount[] | null;
  mix: { profileLabel: string | null; incomePct: number | null; equityPct: number | null; rangeMin: number | null; rangeMax: number | null; targetIncomePct: number | null; status: MixStatus; accounts: { name: string; last4: string | null; incomePct: number | null; status: MixStatus }[] } | null;
  funds: { modelLabel: string; modelAsOf: string; heldInModelPct: number; rows: { name: string; modelPct: number | null; heldPct: number; inModel: boolean }[] } | null;
  reset: { rows: { name: string; owner: string | null; last4: string | null; fundValue: number; currentGuarantee: number; newGuarantee: number; lift: number }[]; totalLift: number } | null;
  disclosures: string[];
}

export const DISCLOSURES = [
  "Returns are those reported by your custodian. Past performance does not guarantee future results.",
  "Segregated fund guarantees are subject to the terms of your contract. Withdrawals reduce the guaranteed amounts in proportion.",
  "This summary is prepared by ProsperWise from your latest statements and is for discussion with your advisor. It is not an offer or a recommendation to buy or sell anything.",
];

const last4 = (n: string | null) => (n ? n.replace(/[^0-9A-Za-z]/g, "").slice(-4) || null : null);
const round1 = (n: number) => Math.round(n * 10) / 10;

const mixStatus = (d: PackAccountOut["drift"]): MixStatus => (d.status === "within" ? "inside" : d.status === "too_little_income" ? "below" : d.status === "too_much_income" ? "above" : "unknown");

export function buildClientView(pack: Pack, includes: ClientIncludes, note: string, householdLabel: string): ClientView {
  const h = pack.household;
  const covered = h.classTotals.income + h.classTotals.canadian_equity + h.classTotals.us_intl_equity + h.classTotals.equity_other;
  const equity = covered > 0 ? 100 - round1((h.classTotals.income / covered) * 100) : null;
  const mc = h.modelComparison;
  return {
    householdLabel,
    valuesAsOf: pack.asOf,
    note: note.trim(),
    summary: { value: pack.totalValue, changeYtd: h.changeYtd, ytdPct: h.valueWeightedYtd },
    accounts: includes.returns ? pack.accounts.map((a) => ({ name: a.name, owner: a.owner, last4: last4(a.number), value: a.value, changeYtd: a.changeYtd, ytdPct: a.returns.ytd, oneYearPct: a.returns.oneYear, threeYearPct: a.returns.threeYear })) : null,
    mix: includes.mix && h.drift.status !== "no_data"
      ? {
        profileLabel: h.drift.profileLabel ?? null, incomePct: h.drift.actualIncomePct, equityPct: equity, rangeMin: h.drift.rangeMin ?? null, rangeMax: h.drift.rangeMax ?? null, targetIncomePct: h.drift.targetIncomePct, status: mixStatus(h.drift),
        accounts: pack.accounts.filter((a) => a.classTotals).map((a) => ({ name: a.name, last4: last4(a.number), incomePct: a.incomePct, status: mixStatus(a.drift) })),
      }
      : null,
    funds: includes.funds && mc
      ? { modelLabel: mc.modelLabel, modelAsOf: mc.modelAsOf, heldInModelPct: round1(100 - mc.offModelPct), rows: mc.rows.map((r) => ({ name: r.name, modelPct: r.modelPct, heldPct: r.actualPct, inModel: r.inModel })) }
      : null,
    reset: includes.reset && pack.resets.toReset > 0
      ? {
        rows: pack.resets.rows.filter((r) => r.status === "reset").map((r) => ({ name: r.name, owner: r.owner, last4: last4(r.number), fundValue: r.fundValue as number, currentGuarantee: r.deathGuarantee as number, newGuarantee: r.fundValue as number, lift: r.room as number })),
        totalLift: pack.resets.totalRoom,
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
