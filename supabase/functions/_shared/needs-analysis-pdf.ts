// needs-analysis-pdf.ts: the content of the Life Insurance Needs Analysis report, from a saved DIME analysis. Pure.
import "./bc-time.ts";
import type { Block } from "./simple-pdf.ts";

const money = (n: unknown) => `$${Math.round(Number(n) || 0).toLocaleString("en-CA")}`;
const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export interface SavedAnalysis { inputs: object; results: object; note?: string | null; savedAt: string; person: string }

export function needsAnalysisBlocks(a: SavedAnalysis): Block[] {
  const i = a.inputs as Record<string, unknown>, r = a.results as Record<string, unknown>;
  const net = Math.max(0, n(i.annualIncome) - n(i.survivorIncome));
  const est = [n(i.finalExpenses) && `final expenses ${money(i.finalExpenses)}`, n(i.taxesAndLegal) && `taxes at death, legal and probate ${money(i.taxesAndLegal)}`, n(i.education) && `education ${money(i.education)}`].filter(Boolean).join("; ");
  const gap = n(r.shortfall) > 0;
  return [
    { kind: "p", text: `Prepared for ${a.person} by Rolf Issler, BMgt, CLU, ProsperWise Advisors, from the analysis saved on ${new Date(a.savedAt).toLocaleDateString("en-CA", { timeZone: "America/Vancouver", dateStyle: "long" })}.`, small: true },
    { kind: "h", text: "Result" },
    { kind: "kv", label: "Total life insurance need:", value: money(r.need) },
    { kind: "kv", label: "Available:", value: money(r.available) },
    { kind: "kv", label: gap ? "Shortfall:" : "Surplus:", value: money(gap ? r.shortfall : r.surplus) },
    { kind: "kv", label: "Need met:", value: `${n(r.percentMet)}%` },
    { kind: "h", text: "How the need was worked out" },
    { kind: "p", text: "The need is the total of four parts, known as DIME: debt, income, mortgage and estate.", small: true },
    { kind: "kv", label: "D, Debt (not the mortgage):", value: money(r.debt) },
    { kind: "kv", label: "I, Income to replace:", value: `${money(i.annualIncome)} a year${n(i.survivorIncome) ? `, less ${money(i.survivorIncome)} the survivor already earns, is ${money(net)}` : ""}, for ${n(i.incomeYears)} years = ${money(r.income)}` },
    { kind: "kv", label: "M, Mortgage:", value: money(r.mortgage) },
    { kind: "kv", label: "E, Estate costs:", value: `${money(r.estate)}${est ? ` (${est})` : ""}` },
    { kind: "h", text: "What is already available" },
    { kind: "kv", label: "Life insurance in force:", value: money(i.lifeInsurance) },
    { kind: "kv", label: "Liquid assets the family would use:", value: money(i.liquidAssets) },
    { kind: "kv", label: "CPP/QPP death benefit:", value: money(i.cppDeathBenefit) },
    ...(a.note?.trim() ? [{ kind: "h" as const, text: "Note" }, { kind: "p" as const, text: a.note.trim() }] : []),
    { kind: "gap", h: 8 },
    { kind: "h", text: "Basis" },
    { kind: "p", small: true, text: "Amounts are in today's dollars. The income part is annual income multiplied by the years to replace; it is not discounted, so it leans toward more coverage. Life insurance in force is taken from the policies on file when the analysis was saved. This analysis supports a recommendation; it is not itself a recommendation of a product." },
  ];
}

const PREPARED = (a: SavedAnalysis) => ({ kind: "p" as const, small: true, text: `Prepared for ${a.person} by Rolf Issler, BMgt, CLU, ProsperWise Advisors, from the analysis saved on ${new Date(a.savedAt).toLocaleDateString("en-CA", { timeZone: "America/Vancouver", dateStyle: "long" })}.` });
const NOTE = (a: SavedAnalysis): Block[] => (a.note?.trim() ? [{ kind: "h", text: "Note" }, { kind: "p", text: a.note.trim() }] : []);
const perMonth = (v: unknown) => `${money(v)} a month`;

/** The Disability Needs Analysis report, from a saved disability analysis (with the business overhead part when the person has a corporation). */
export function disabilityBlocks(a: SavedAnalysis): Block[] {
  const i = a.inputs as Record<string, unknown>, r = a.results as Record<string, any>;
  const gap = n(r.gap) > 0;
  const boe = r.boe as Record<string, unknown> | null;
  return [
    PREPARED(a),
    { kind: "h", text: "Result" },
    { kind: "kv", label: "Monthly income to protect:", value: perMonth(r.target) },
    { kind: "kv", label: "Already available:", value: perMonth(r.available) },
    { kind: "kv", label: gap ? "Monthly benefit still needed:" : "Surplus:", value: perMonth(gap ? r.gap : r.surplus) },
    { kind: "kv", label: "Need met:", value: `${n(r.percentMet)}%` },
    { kind: "h", text: "How the need was worked out" },
    { kind: "kv", label: "Gross income:", value: `${money(i.annualIncome)} a year, ${money(r.monthlyIncome)} a month` },
    { kind: "kv", label: "Income to replace:", value: `${n(i.replacePercent)}% = ${perMonth(r.target)}` },
    { kind: "kv", label: "Waiting period:", value: `${n(i.waitingDays)} days (about ${money(r.waitingBridge)} of income to carry before benefits start)` },
    { kind: "kv", label: "Benefit period:", value: `${n(i.benefitMonths)} months (the gap adds up to ${money(r.exposure)} over that time)` },
    { kind: "h", text: "What is already available" },
    { kind: "kv", label: "Group disability benefit:", value: perMonth(i.groupBenefit) },
    { kind: "kv", label: "CPP/QPP disability benefit:", value: perMonth(i.cppBenefit) },
    { kind: "kv", label: "Disability policies in force:", value: perMonth(i.inForce) },
    ...(boe ? [
      { kind: "h" as const, text: "Business overhead expense (BOE)" },
      { kind: "p" as const, small: true, text: "BOE cover reimburses the corporation for its fixed expenses while the owner is disabled. It protects the business, not the owner's own income, so it is worked out apart from the figures above." },
      { kind: "kv" as const, label: "Fixed monthly expenses to keep paying:", value: perMonth(boe.need) },
      { kind: "kv" as const, label: "BOE benefit in force:", value: perMonth(i.boeInForce) },
      { kind: "kv" as const, label: n(boe.gap) > 0 ? "BOE benefit still needed:" : "BOE surplus:", value: perMonth(n(boe.gap) > 0 ? boe.gap : Math.max(0, n(i.boeInForce) - n(boe.need))) },
      { kind: "kv" as const, label: "Benefit period:", value: `${n(i.boeMonths)} months (${money(boe.exposure)} over that time)` },
    ] : []),
    ...NOTE(a),
    { kind: "gap", h: 8 },
    { kind: "h", text: "Basis" },
    { kind: "p", small: true, text: "Amounts are in today's dollars. The share of income replaced, the waiting period and the benefit period are the advisor's working assumptions for this client and can be changed; insurers also limit the total benefit they will issue relative to income. Benefits from a group plan and CPP/QPP are the amounts the client reported or expects, and the policies in force are taken from the policies on file at the time of saving." },
  ];
}

/** The Critical Illness Needs Analysis report, from a saved critical illness analysis. */
export function criticalIllnessBlocks(a: SavedAnalysis): Block[] {
  const i = a.inputs as Record<string, unknown>, r = a.results as Record<string, unknown>;
  const gap = n(r.shortfall) > 0;
  return [
    PREPARED(a),
    { kind: "h", text: "Result" },
    { kind: "kv", label: "Lump sum needed:", value: money(r.need) },
    { kind: "kv", label: "Critical illness cover in force:", value: money(r.available) },
    { kind: "kv", label: gap ? "Shortfall:" : "Surplus:", value: money(gap ? r.shortfall : r.surplus) },
    { kind: "kv", label: "Need met:", value: `${n(r.percentMet)}%` },
    { kind: "h", text: "How the need was worked out" },
    { kind: "kv", label: "Income while recovering:", value: `${money(i.annualIncome)} a year for ${n(i.incomeYears)} year${n(i.incomeYears) === 1 ? "" : "s"} = ${money(r.income)}` },
    { kind: "kv", label: "Treatment and recovery costs:", value: money(r.treatment) },
    { kind: "kv", label: "Debts to clear:", value: money(r.debts) },
    ...NOTE(a),
    { kind: "gap", h: 8 },
    { kind: "h", text: "Basis" },
    { kind: "p", small: true, text: "Amounts are in today's dollars. Critical illness cover pays a tax-free lump sum on diagnosis of a covered condition, so the need is the income to bridge while recovering plus the costs of recovery. The years of income and the recovery costs are working assumptions for this client and can be changed. Cover in force is taken from the policies on file at the time of saving." },
  ];
}
