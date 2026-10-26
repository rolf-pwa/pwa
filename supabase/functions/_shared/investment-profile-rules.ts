// investment-profile-rules.ts: the investor profile and needs analysis for one person (segregated funds): what is saved, cleaned, and the report built from it. Pure.
// The risk profile is not scored here: it is the one recorded in the investor profile completed online with the iA application, chosen from iA's model portfolios.
import "./bc-time.ts";
import type { Block } from "./simple-pdf.ts";

export const OBJECTIVES: Record<string, string> = { growth: "Grow capital", income: "Generate income", preservation: "Preserve capital", estate: "Pass wealth to the family (estate)", tax: "Reduce tax" };
export const STABILITY: Record<string, string> = { stable: "Stable", variable: "Variable", unsure: "Not sure" };
export const KNOWLEDGE: Record<string, string> = { none: "None", limited: "Limited", good: "Good", extensive: "Extensive" };
export const GUARANTEE: Record<string, string> = { low: "Not important", medium: "Somewhat important", high: "Very important" };

export interface ProfileInputs {
  objectives: string[]; timeHorizonYears: number; amountToInvest: number; sourceOfFunds: string; accountTypes: string;
  annualIncome: number; incomeStability: string; currentInvestments: number; liabilities: number;
  liquidityNeedsAmount: number; liquidityNeedsWhen: string; knowledge: string; experienceYears: number; guaranteeImportance: string; concerns: string;
  /** The iA model portfolio profile key (prudent, moderate, balanced, growth, aggressive), the date iA's investor profile was completed, and where it is. */
  riskProfile: string; riskProfileDate: string; riskProfileEvidence: string;
}
export const EMPTY_PROFILE: ProfileInputs = {
  objectives: [], timeHorizonYears: 0, amountToInvest: 0, sourceOfFunds: "", accountTypes: "", annualIncome: 0, incomeStability: "", currentInvestments: 0, liabilities: 0,
  liquidityNeedsAmount: 0, liquidityNeedsWhen: "", knowledge: "", experienceYears: 0, guaranteeImportance: "", concerns: "", riskProfile: "", riskProfileDate: "", riskProfileEvidence: "",
};

const num = (v: unknown) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 0);
const text = (v: unknown, n: number) => String(v ?? "").trim().slice(0, n);
const pick = (v: unknown, allowed: Record<string, string>) => (typeof v === "string" && v in allowed ? v : "");

/** What is stored: only the known fields, in the known shapes. Anything else a client sends is dropped. */
export function cleanProfile(raw: unknown): ProfileInputs {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(r.riskProfileDate ?? "")) ? String(r.riskProfileDate) : "";
  return {
    objectives: (Array.isArray(r.objectives) ? r.objectives : []).filter((o): o is string => typeof o === "string" && o in OBJECTIVES).filter((o, i, a) => a.indexOf(o) === i),
    timeHorizonYears: Math.min(80, Math.round(num(r.timeHorizonYears))), amountToInvest: num(r.amountToInvest), sourceOfFunds: text(r.sourceOfFunds, 200), accountTypes: text(r.accountTypes, 200),
    annualIncome: num(r.annualIncome), incomeStability: pick(r.incomeStability, STABILITY), currentInvestments: num(r.currentInvestments), liabilities: num(r.liabilities),
    liquidityNeedsAmount: num(r.liquidityNeedsAmount), liquidityNeedsWhen: text(r.liquidityNeedsWhen, 200), knowledge: pick(r.knowledge, KNOWLEDGE), experienceYears: Math.min(80, Math.round(num(r.experienceYears))),
    guaranteeImportance: pick(r.guaranteeImportance, GUARANTEE), concerns: text(r.concerns, 1500),
    riskProfile: /^[a-z0-9_-]{2,40}$/.test(String(r.riskProfile ?? "")) ? String(r.riskProfile) : "", riskProfileDate: date, riskProfileEvidence: text(r.riskProfileEvidence, 300),
  };
}

/** The gaps to fill before the file can rely on this profile. The risk profile is the one that is usually not known until the application. */
export function profileGaps(i: ProfileInputs): string[] {
  const g: string[] = [];
  if (!i.objectives.length) g.push("the objectives");
  if (!i.timeHorizonYears) g.push("the time horizon");
  if (!i.amountToInvest) g.push("the amount to invest");
  if (!i.annualIncome) g.push("income");
  if (!i.knowledge) g.push("investment knowledge");
  if (!i.riskProfile) g.push("the risk profile from the iA investor profile");
  return g;
}

export interface ModelLite { profile_key: string; label: string; income_min: number; income_max: number; equity_min: number; equity_max: number; as_of?: string }
const money = (v: unknown) => `$${Math.round(num(v)).toLocaleString("en-CA")}`;
const day = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Vancouver", dateStyle: "long" });

/** The Investor Profile and Needs Analysis report for one person. */
export function profileBlocks(a: { inputs: ProfileInputs; person: string; savedAt: string; note: string | null; model: ModelLite | null }): Block[] {
  const i = a.inputs;
  const kv = (label: string, value: string): Block[] => (value ? [{ kind: "kv", label, value }] : []);
  const net = num(i.currentInvestments) - num(i.liabilities);
  return [
    { kind: "p", small: true, text: `Prepared for ${a.person} by Rolf Issler, BMgt, CLU, ProsperWise Advisors, from the profile saved on ${day(a.savedAt)}.` },
    { kind: "h", text: "What you want from your investments" },
    ...kv("Objectives:", i.objectives.map((o) => OBJECTIVES[o]).join("; ")),
    ...kv("Time horizon:", i.timeHorizonYears ? `${i.timeHorizonYears} years` : ""),
    ...kv("Amount to invest:", i.amountToInvest ? money(i.amountToInvest) : ""),
    ...kv("Where the money comes from:", i.sourceOfFunds),
    ...kv("Kind of accounts:", i.accountTypes),
    ...kv("Importance of guarantees:", GUARANTEE[i.guaranteeImportance] ?? ""),
    { kind: "h", text: "Your financial situation" },
    ...kv("Annual income:", i.annualIncome ? `${money(i.annualIncome)}${STABILITY[i.incomeStability] ? ` (${STABILITY[i.incomeStability].toLowerCase()})` : ""}` : ""),
    ...kv("Investments held today:", i.currentInvestments ? money(i.currentInvestments) : ""),
    ...kv("Debts:", i.liabilities ? money(i.liabilities) : ""),
    ...(i.currentInvestments || i.liabilities ? [{ kind: "kv" as const, label: "Investments less debts:", value: `${net < 0 ? "-" : ""}${money(Math.abs(net))}` }] : []),
    ...kv("Money you may need soon:", i.liquidityNeedsAmount ? `${money(i.liquidityNeedsAmount)}${i.liquidityNeedsWhen ? `, ${i.liquidityNeedsWhen}` : ""}` : ""),
    { kind: "h", text: "Your experience" },
    ...kv("Investment knowledge:", KNOWLEDGE[i.knowledge] ?? ""),
    ...kv("Years investing:", i.experienceYears ? String(i.experienceYears) : ""),
    ...(i.concerns ? [{ kind: "p" as const, text: `Concerns and notes: ${i.concerns}` }] : []),
    { kind: "h", text: "Risk profile" },
    ...(a.model
      ? [{ kind: "kv" as const, label: "Risk profile:", value: a.model.label }, { kind: "kv" as const, label: "iA model portfolio mix:", value: `${a.model.income_min}% to ${a.model.income_max}% fixed income, ${a.model.equity_min}% to ${a.model.equity_max}% equity` }]
      : [{ kind: "p" as const, text: i.riskProfile ? `Risk profile: ${i.riskProfile}` : "The risk profile has not been recorded yet. It comes from the investor profile completed online with the iA application." }]),
    ...kv("Recorded from the iA investor profile completed on:", i.riskProfileDate ? day(`${i.riskProfileDate}T12:00:00Z`) : ""),
    ...kv("Where it is kept:", i.riskProfileEvidence),
    ...(a.note?.trim() ? [{ kind: "h" as const, text: "Note" }, { kind: "p" as const, text: a.note.trim() }] : []),
    { kind: "gap", h: 8 },
    { kind: "h", text: "Basis" },
    { kind: "p", small: true, text: "This profile records what you told us and what is in your file at the date shown. The risk profile is the one produced by the investor profile you completed online with iA when you applied; we use it to choose the iA model portfolio. Please tell us when your circumstances, goals or comfort with risk change, so the profile can be updated." },
  ];
}
