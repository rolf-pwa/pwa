// needs-analysis-pdf.ts: the content of the Life Insurance Needs Analysis report, from a saved DIME analysis. Pure.
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
