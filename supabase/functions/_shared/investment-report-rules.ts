// investment-report-rules.ts: the Investment Recommendation Report given to the client: where they stand, how the portfolio was chosen, what is recommended (the iA model
// portfolio and its funds, the amount, guarantee and fees) and what happens next. Pure: it reads saved profiles and recommendations only.
import "./bc-time.ts";
import type { Block } from "./simple-pdf.ts";
import { GUARANTEE, KNOWLEDGE, OBJECTIVES, STABILITY, type ProfileInputs } from "./investment-profile-rules.ts";
import type { ModelFull } from "./investment-recommendation-rules.ts";

export interface ReportRec { profileKey: string; amount: number; accounts: string; guarantee: string; fees: string; reason: string; deviationReason: string }
export interface ReportPerson { name: string; profile: ProfileInputs | null; profileSavedAt: string | null; rec: ReportRec | null }
export interface InvestmentReportInput { preparedOn: string; coverNote: string | null; includeFunds: boolean; models: ModelFull[]; people: ReportPerson[] }

const num = (v: unknown) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 0);
const money = (v: unknown) => `$${Math.round(num(v)).toLocaleString("en-CA")}`;
const day = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Vancouver", dateStyle: "long" });
const joinNames = (names: string[]) => (names.length <= 2 ? names.join(" and ") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`);

export function investmentReportBlocks(i: InvestmentReportInput): Block[] {
  const names = i.people.map((p) => p.name);
  const model = (key: string) => i.models.find((m) => m.profile_key === key);
  const blocks: Block[] = [{ kind: "p", small: true, text: `Prepared for ${joinNames(names)} by Rolf Issler, BMgt, CLU, ProsperWise Advisors, on ${i.preparedOn}.` }];
  if (i.coverNote?.trim()) blocks.push({ kind: "h", text: "A note from Rolf" }, { kind: "p", text: i.coverNote.trim() });

  blocks.push({ kind: "h", text: "Where you stand today" });
  for (const p of i.people) {
    if (!p.profile) { blocks.push({ kind: "p", small: true, text: `${p.name}: no investor profile has been saved yet.` }); continue; }
    const f = p.profile, risk = f.riskProfile ? model(f.riskProfile) : null;
    blocks.push({ kind: "card", title: p.name, lines: [
      ...(f.objectives.length ? [`What you want: ${f.objectives.map((o) => OBJECTIVES[o]).join("; ")}`] : []),
      ...(f.timeHorizonYears ? [`Time horizon: ${f.timeHorizonYears} years`] : []),
      ...(f.annualIncome ? [`Income: ${money(f.annualIncome)} a year${STABILITY[f.incomeStability] ? ` (${STABILITY[f.incomeStability].toLowerCase()})` : ""}`] : []),
      ...(f.currentInvestments ? [`Investments held today: ${money(f.currentInvestments)}`] : []),
      ...(f.knowledge ? [`Investment knowledge: ${KNOWLEDGE[f.knowledge]}`] : []),
      ...(f.guaranteeImportance ? [`Importance of guarantees: ${GUARANTEE[f.guaranteeImportance]}`] : []),
      f.riskProfile ? `Risk profile from the investor profile you completed with iA: ${risk?.label ?? f.riskProfile}${f.riskProfileDate ? ` (${day(`${f.riskProfileDate}T12:00:00Z`)})` : ""}` : "Risk profile: to be recorded from the investor profile you complete with the iA application",
      ...(p.profileSavedAt ? [`Profile saved ${day(p.profileSavedAt)}`] : []),
    ] });
  }

  blocks.push({ kind: "h", text: "How we chose your portfolio" });
  blocks.push({ kind: "p", small: true, text: "iA publishes model portfolios, each built for a risk profile. The investor profile you complete online with iA when you apply produces your risk profile, and we recommend the model portfolio built for it. If we recommend a different one, we say why." });

  blocks.push({ kind: "h", text: "Our recommendation" });
  let any = false;
  for (const p of i.people) {
    if (!p.rec) { if (p.profile) blocks.push({ kind: "p", small: true, text: `${p.name}: we have not yet made a recommendation.` }); continue; }
    any = true;
    const m = model(p.rec.profileKey), fitted = p.profile?.riskProfile ? model(p.profile.riskProfile) : null;
    const different = !!fitted && fitted.profile_key !== p.rec.profileKey;
    blocks.push({ kind: "card", title: `${p.name}: iA ${m?.label ?? p.rec.profileKey} model portfolio`, lines: [
      ...(m ? [`Mix: ${m.income_min}% to ${m.income_max}% fixed income, ${m.equity_min}% to ${m.equity_max}% equity`] : []),
      ...(p.rec.amount ? [`Amount to invest: ${money(p.rec.amount)}`] : []),
      ...(p.rec.accounts ? [`Accounts: ${p.rec.accounts}`] : []),
      ...(p.rec.guarantee ? [`Guarantee: ${p.rec.guarantee}`] : []),
      ...(p.rec.fees ? [`Fees: ${p.rec.fees}`] : []),
      ...(p.rec.reason ? [`Why we recommend it: ${p.rec.reason}`] : []),
      ...(different ? [`Why not the ${fitted!.label} portfolio for your risk profile: ${p.rec.deviationReason || "to be explained"}`] : []),
    ] });
    if (i.includeFunds && m?.funds?.length) blocks.push({ kind: "card", title: `What the ${m.label} portfolio holds${m.as_of ? ` (iA, as at ${m.as_of})` : ""}`, lines: [...m.funds].sort((a, b) => b.weight - a.weight).map((f) => `${f.name}: ${f.weight}%`) });
  }
  if (!any) blocks.push({ kind: "p", text: "No recommendations have been made yet." });

  blocks.push(
    { kind: "h", text: "What to be aware of" },
    { kind: "p", small: true, text: "The value of a segregated fund goes up and down with the markets. Only the guarantees described in your contract are guaranteed. Fees reduce what you earn. Please read the Fund Facts and the information folder for each fund before you invest, and ask me about anything that is unclear." },
    { kind: "h", text: "What happens next" },
    { kind: "p", text: "1. Review this report and tell me which recommendations you would like to go ahead with, and anything you would change." },
    { kind: "p", text: "2. We complete the application with iA together, including the investor profile that sets your risk profile." },
    { kind: "p", text: "3. Read the Fund Facts and the information folder, and ask me your questions before you sign." },
    { kind: "p", text: "4. Once the contract is issued I will deliver it and confirm in writing." },
    { kind: "gap", h: 6 },
    { kind: "p", small: true, text: "This report is not an insurance contract or an offer of one; the contract issued by iA prevails. Model portfolios are as published by iA on the date shown and can change." },
  );
  return blocks;
}
