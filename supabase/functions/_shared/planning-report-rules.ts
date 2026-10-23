// planning-report-rules.ts: the Insurance Planning Report given to the client: where they stand (life, critical illness, disability and business overhead
// expense), how it was worked out, what is recommended and what it costs, and optionally the options compared. Pure: it reads saved analyses and quotes only.
import type { Block } from "./simple-pdf.ts";
import { annualCost, costPerUnit, type QuoteRow } from "./quote-rules.ts";

export type ReportKind = "life" | "critical_illness" | "disability";
export const REPORT_KINDS: ReportKind[] = ["life", "critical_illness", "disability"];
export const KIND_LABEL: Record<ReportKind, string> = { life: "Life insurance", critical_illness: "Critical illness", disability: "Disability" };

export interface SavedAnalysis { inputs: Record<string, any>; results: Record<string, any>; savedAt: string }
export interface ReportPerson { name: string; analyses: Partial<Record<ReportKind, SavedAnalysis>>; quotes: QuoteRow[] }
export interface ReportInput { household: string; preparedOn: string; coverNote: string | null; kinds: ReportKind[]; includeOptions: boolean; people: ReportPerson[] }

const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const money = (v: unknown) => `$${Math.round(n(v)).toLocaleString("en-CA")}`;
const money2 = (v: number) => `$${v.toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const perMonth = (v: unknown) => `${money(v)} a month`;
const day = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Vancouver", dateStyle: "long" });
const joinNames = (names: string[]) => names.length <= 2 ? names.join(" and ") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

/** Which kind of cover a quote is for, and whether it is the business overhead part of disability. */
export const kindOfQuote = (q: Pick<QuoteRow, "policy_type">): ReportKind | null =>
  ["term", "whole_life", "universal_life"].includes(q.policy_type) ? "life" : q.policy_type === "critical_illness" ? "critical_illness" : q.policy_type === "disability" ? "disability" : null;
const isBoe = (q: Pick<QuoteRow, "policy_type" | "benefit_kind">) => q.policy_type === "disability" && q.benefit_kind === "overhead";
const TYPE_NAME: Record<string, string> = { term: "Term life insurance", whole_life: "Whole life insurance", universal_life: "Universal life insurance", critical_illness: "Critical illness insurance", disability: "Disability insurance" };
const groupName = (q: QuoteRow) => (isBoe(q) ? "Business overhead expense" : TYPE_NAME[q.policy_type] ?? "Insurance");

/** The premium as a monthly amount, or null when it has none (a single premium). */
export const monthlyPremium = (q: Pick<QuoteRow, "premium_amount" | "premium_frequency">): number | null => { const a = annualCost(q); return a === null ? null : a / 12; };

function quoteLines(q: QuoteRow, withReason: boolean): string[] {
  const di = q.policy_type === "disability", c = n(q.coverage_amount), mo = monthlyPremium(q), a = annualCost(q);
  return [
    di ? `Monthly benefit: ${c ? money(c) : "not stated"}${q.waiting_days !== null && q.waiting_days !== undefined ? `, ${q.waiting_days}-day waiting period` : ""}${q.benefit_period ? `, benefits for ${q.benefit_period}` : ""}${q.occupation ? `, ${q.occupation}` : ""}`
      : `${q.policy_type === "critical_illness" ? "Lump sum" : "Coverage"}: ${c ? money(c) : "not stated"}${q.term_years ? `, ${q.term_years}-year term` : ""}`,
    `Premium: ${mo !== null ? `${money2(mo)} a month${a !== null && q.premium_frequency !== "monthly" ? ` (${money(a)} a year)` : ""}` : "not stated"}`,
    ...(q.riders ? [`Options and riders: ${q.riders}`] : []),
    ...(q.guarantees ? [`What is guaranteed: ${q.guarantees}`] : []),
    ...(q.underwriting ? [`Based on: ${q.underwriting}`] : []),
    ...(q.quote_date ? [`Quoted ${q.quote_date}${q.valid_until ? `, valid until ${q.valid_until}` : ""}`] : []),
    ...(withReason && q.reason ? [`Why we recommend it: ${q.reason.trim().replace(/[.\s]+$/, "")}.`] : []),
  ];
}

function standingCards(p: ReportPerson, kinds: ReportKind[]): Block[] {
  const out: Block[] = [];
  for (const kind of kinds) {
    const a = p.analyses[kind];
    if (!a) { out.push({ kind: "p", small: true, text: `${p.name}: no ${KIND_LABEL[kind].toLowerCase()} needs analysis has been saved yet.` }); continue; }
    const r = a.results, i = a.inputs, saved = `Analysis of ${day(a.savedAt)}`;
    if (kind === "life") {
      out.push({ kind: "card", title: `${p.name}: Life insurance`, lines: [`Total need: ${money(r.need)} (debt ${money(r.debt)}, income ${money(r.income)}, mortgage ${money(r.mortgage)}, estate costs ${money(r.estate)})`, `Already in place: ${money(r.available)} (life insurance, liquid assets and the CPP/QPP death benefit)`, n(r.shortfall) > 0 ? `Still needed: ${money(r.shortfall)}` : `Covered, with a surplus of ${money(r.surplus)}`, `Need met today: ${n(r.percentMet)}%`, saved] });
    } else if (kind === "critical_illness") {
      out.push({ kind: "card", title: `${p.name}: Critical illness`, lines: [`Lump sum needed: ${money(r.need)} (${n(i.incomeYears)} year${n(i.incomeYears) === 1 ? "" : "s"} of income ${money(r.income)}, recovery costs ${money(r.treatment)}${n(r.debts) ? `, debts ${money(r.debts)}` : ""})`, `Already in place: ${money(r.available)}`, n(r.shortfall) > 0 ? `Still needed: ${money(r.shortfall)}` : `Covered, with a surplus of ${money(r.surplus)}`, `Need met today: ${n(r.percentMet)}%`, saved] });
    } else {
      out.push({ kind: "card", title: `${p.name}: Disability income`, lines: [`Monthly income to protect: ${perMonth(r.target)} (${n(i.replacePercent)}% of gross income of ${money(i.annualIncome)} a year)`, `Already in place: ${perMonth(r.available)} (group plan, CPP/QPP disability and individual policies)`, n(r.gap) > 0 ? `Monthly benefit still needed: ${perMonth(r.gap)}` : `Covered, with a surplus of ${perMonth(r.surplus)}`, `Waiting period ${n(i.waitingDays)} days; benefits for ${n(i.benefitMonths)} months`, saved] });
      if (r.boe) out.push({ kind: "card", title: `${p.name}: Business overhead expense`, lines: [`Fixed business expenses to keep paying: ${perMonth(r.boe.need)}`, `Already in place: ${perMonth(i.boeInForce)}`, n(r.boe.gap) > 0 ? `Monthly benefit still needed: ${perMonth(r.boe.gap)}` : "Covered", `Benefits for ${n(i.boeMonths)} months`, saved] });
    }
  }
  return out;
}

const BASIS: Record<ReportKind, string> = {
  life: "Life insurance: the need is debt, income to replace, mortgage and estate costs (known as DIME), less life insurance in force, liquid assets and the CPP/QPP death benefit.",
  critical_illness: "Critical illness: a tax-free lump sum on diagnosis of a covered condition, sized to bridge income while recovering plus the costs of recovery.",
  disability: "Disability: a share of gross income paid monthly after a waiting period for a benefit period, less group, CPP/QPP and individual cover already in place. For a business owner, business overhead expense cover reimburses the business's fixed expenses, so it is worked out separately.",
};

export function planningReportBlocks(i: ReportInput): Block[] {
  const names = i.people.map((p) => p.name);
  const kinds = REPORT_KINDS.filter((k) => i.kinds.includes(k));
  const blocks: Block[] = [{ kind: "p", small: true, text: `Prepared for ${joinNames(names)} by Rolf Issler, BMgt, CLU, ProsperWise Advisors, on ${i.preparedOn}.` }];
  if (i.coverNote?.trim()) blocks.push({ kind: "h", text: "A note from Rolf" }, { kind: "p", text: i.coverNote.trim() });

  blocks.push({ kind: "h", text: "Where you stand today" });
  for (const p of i.people) blocks.push(...standingCards(p, kinds));

  blocks.push({ kind: "h", text: "How we worked this out" });
  for (const k of kinds) blocks.push({ kind: "p", small: true, text: BASIS[k] });
  blocks.push({ kind: "p", small: true, text: "Amounts are in today's dollars. The assumptions (the share of income replaced, the waiting and benefit periods, the years of income and recovery costs) are working figures for you that we can change together." });

  // The recommendation: each person's recommended quotes of the kinds in the report, and what they cost together.
  blocks.push({ kind: "h", text: "Our recommendation" });
  let household = 0, any = false;
  for (const p of i.people) {
    const mine = p.quotes.filter((q) => q.status === "recommended" && kinds.includes(kindOfQuote(q) as ReportKind));
    let total = 0;
    for (const q of mine) { any = true; total += monthlyPremium(q) ?? 0; blocks.push({ kind: "card", title: `${p.name}: ${groupName(q)}, ${q.carrier} ${q.product}`, lines: quoteLines(q, true) }); }
    for (const k of kinds) {
      const needed = k === "life" ? n(p.analyses.life?.results.shortfall) > 0 : k === "critical_illness" ? n(p.analyses.critical_illness?.results.shortfall) > 0 : n(p.analyses.disability?.results.gap) > 0;
      if (needed && !mine.some((q) => kindOfQuote(q) === k)) blocks.push({ kind: "p", small: true, text: `${p.name}: we have not yet made a recommendation for ${KIND_LABEL[k].toLowerCase()}.` });
    }
    if (mine.length) { blocks.push({ kind: "kv", label: `${p.name}, recommended cover:`, value: `${money2(total)} a month` }); household += total; }
  }
  if (!any) blocks.push({ kind: "p", text: "No recommendations have been made yet." });
  else if (i.people.length > 1) blocks.push({ kind: "kv", label: "All recommended cover together:", value: `${money2(household)} a month (${money(household * 12)} a year)` });

  if (i.includeOptions) {
    const sections: Block[] = [];
    for (const p of i.people) {
      const groups = new Map<string, QuoteRow[]>();
      for (const q of p.quotes) { const k = kindOfQuote(q); if (!k || !kinds.includes(k)) continue; const key = isBoe(q) ? "disability:boe" : q.policy_type === "term" || q.policy_type === "whole_life" || q.policy_type === "universal_life" ? "life" : q.policy_type; groups.set(key, [...(groups.get(key) ?? []), q]); }
      for (const qs of groups.values()) {
        if (qs.length < 2) continue;
        const di = qs[0].policy_type === "disability";
        const lines = [...qs].sort((a, b) => (a.status === "recommended" ? -1 : 0) - (b.status === "recommended" ? -1 : 0)).map((q) => {
          const mo = monthlyPremium(q), u = costPerUnit(q);
          return `${q.carrier}, ${q.product}${q.status === "recommended" ? " (recommended)" : q.status === "rejected" ? " (not chosen)" : ""}: ${n(q.coverage_amount) ? `${money(q.coverage_amount)}${di ? " a month" : ""}` : "amount not stated"}, ${mo !== null ? `${money2(mo)} a month` : "premium not stated"}${u !== null ? `, ${money2(u)} a year per ${di ? "$100 of monthly benefit" : "$1,000 of coverage"}` : ""}${q.status === "rejected" && q.reason ? `. Why not: ${q.reason.trim().replace(/[.\s]+$/, "")}` : ""}`;
        });
        sections.push({ kind: "card", title: `${p.name}: ${groupName(qs[0])}, options compared`, lines });
      }
    }
    if (sections.length) blocks.push({ kind: "h", text: "Options we compared" }, ...sections, { kind: "p", small: true, text: "Cost per $1,000 of coverage (or per $100 of monthly benefit for disability) compares options of different sizes, but it is not the only thing that matters: guarantees, riders, the definition of disability and the strength of the carrier count too." });
  }

  blocks.push(
    { kind: "h", text: "What happens next" },
    { kind: "p", text: "1. Review this report and tell me which of the recommendations you would like to go ahead with, and anything you would change." },
    { kind: "p", text: "2. We complete the application together. The insurer may ask health questions or for medical information, and its decision can change the premium or the terms from what is quoted here." },
    { kind: "p", text: "3. Once the policy is issued I will deliver it and confirm in writing." },
    { kind: "gap", h: 6 },
    { kind: "p", small: true, text: "Premiums are as quoted on the dates shown and can change at application. This report is not an insurance contract or an offer of insurance; the contract issued by the insurer prevails." },
  );
  return blocks;
}
