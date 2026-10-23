// investment-recommendation-rules.ts: the recommendation for a segregated funds client (the iA model portfolio) and the reason why letter that explains it. Pure.
// The portfolio follows the risk profile recorded from the iA investor profile; recommending a different one needs a reason, and the letter says so.
import { GUARANTEE, KNOWLEDGE, OBJECTIVES, type ModelLite, type ProfileInputs } from "./investment-profile-rules.ts";

export interface ModelFull extends ModelLite { funds: { name: string; weight: number }[]; income_target?: number }
export interface RecommendationInput { profileKey: string; amount: number; accounts: string; guarantee: string; fees: string; reason: string; deviationReason: string }

const num = (v: unknown) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 0);
const text = (v: unknown, n: number) => String(v ?? "").trim().slice(0, n);
const money = (v: unknown) => `$${Math.round(num(v)).toLocaleString("en-CA")}`;
const day = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "America/Vancouver", dateStyle: "long" });

export function cleanRecommendation(raw: unknown): RecommendationInput {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    profileKey: /^[a-z0-9_-]{2,40}$/.test(String(r.profileKey ?? "")) ? String(r.profileKey) : "", amount: num(r.amount), accounts: text(r.accounts, 200),
    guarantee: text(r.guarantee, 300), fees: text(r.fees, 400), reason: text(r.reason, 2000), deviationReason: text(r.deviationReason, 600),
  };
}

/** The problems with a recommendation before it is saved or sent: what is missing, and a portfolio that is not the one for the client's risk profile without a reason. */
export function recommendationIssues(r: RecommendationInput, riskProfile: string, models: ModelLite[]): string[] {
  const out: string[] = [];
  if (!r.profileKey) out.push("Choose the model portfolio.");
  else if (!models.some((m) => m.profile_key === r.profileKey)) out.push("That is not one of iA's model portfolios.");
  if (!riskProfile) out.push("Record the risk profile from the iA investor profile first: the portfolio follows it.");
  else if (r.profileKey && r.profileKey !== riskProfile && !r.deviationReason) out.push("This is not the model for the client's risk profile. Say why.");
  if (!r.amount) out.push("Enter the amount to invest.");
  return out;
}

/** A first draft of the reasons, from the saved profile and the portfolio; the advisor rewrites it in his own words. */
export function defaultReason(i: ProfileInputs, model: ModelLite): string {
  const goals = i.objectives.map((o) => (OBJECTIVES[o] ?? o).toLowerCase());
  const parts = [
    goals.length ? `You told me you want to ${goals.join(" and ")}${i.timeHorizonYears ? `, over about ${i.timeHorizonYears} years` : ""}.` : i.timeHorizonYears ? `Your time horizon is about ${i.timeHorizonYears} years.` : "",
    `The investor profile you completed with iA produced a ${model.label} risk profile, and the iA ${model.label} model portfolio is built for it: ${model.income_min}% to ${model.income_max}% in fixed income and ${model.equity_min}% to ${model.equity_max}% in equity.`,
    i.knowledge ? `Your investment knowledge is ${(KNOWLEDGE[i.knowledge] ?? "").toLowerCase()}, so a managed portfolio of funds chosen by iA suits you better than picking funds yourself.` : "",
    i.guaranteeImportance === "high" || i.guaranteeImportance === "medium" ? `You said guarantees are ${(GUARANTEE[i.guaranteeImportance] ?? "").toLowerCase()}; a segregated fund contract carries the guarantees described in your contract.` : "",
    i.liquidityNeedsAmount ? `You may need ${money(i.liquidityNeedsAmount)}${i.liquidityNeedsWhen ? ` ${i.liquidityNeedsWhen}` : ""}, which I have kept in mind.` : "",
  ];
  return parts.filter(Boolean).join(" ");
}

/** The reason why letter, as Markdown the advisor edits before it is sent. Anything not yet known is left as a blank (____) and the letter will not send until it is filled in. */
export function reasonWhyLetter(i: { person: string; date: Date; profile: ProfileInputs; model: ModelFull; defaultModel: ModelFull | null; rec: RecommendationInput }): string {
  const { person, model: m, rec } = i;
  const funds = [...(m.funds ?? [])].sort((a, b) => b.weight - a.weight);
  const different = i.defaultModel && i.defaultModel.profile_key !== m.profile_key;
  return [
    `# Reason Why: Segregated Fund Recommendation`,
    `**Date:** ${day(i.date)}  \n**For:** ${person}  \n**From:** Rolf Issler, ProsperWise Advisors`,
    `## What I recommend`,
    `I recommend investing ${rec.amount ? money(rec.amount) : "____"} in the iA ${m.label} model portfolio, through a segregated fund contract with iA Financial Group${rec.accounts ? `, held in your ${rec.accounts}` : ""}.`,
    `## Why it suits you`,
    rec.reason || "____",
    ...(different ? [`**A note on the risk profile.** Your investor profile with iA gave a ${i.defaultModel!.label} risk profile. I am recommending the ${m.label} portfolio instead because: ${rec.deviationReason || "____"}`] : []),
    `## What the portfolio holds`,
    `The ${m.label} model portfolio is ${m.income_min}% to ${m.income_max}% fixed income and ${m.equity_min}% to ${m.equity_max}% equity. Its funds${m.as_of ? ` (iA's model portfolios as at ${m.as_of})` : ""}:`,
    funds.length ? funds.map((f) => `- ${f.name}: ${f.weight}%`).join("\n") : "- ____",
    `## Guarantees and fees`,
    `**Guarantee:** ${rec.guarantee || "____"}`,
    `**Fees:** ${rec.fees || "____"}`,
    `## What to be aware of`,
    `- The value of a segregated fund goes up and down with the markets. Only the guarantees described in your contract are guaranteed.`,
    `- Fees reduce what you earn, whether markets rise or fall.`,
    `- Please read the Fund Facts and the information folder for each fund before you invest. If anything in them is unclear, ask me.`,
    `- You can withdraw money, but there may be charges, and a withdrawal can reduce your guarantees.`,
    `## Your right to cancel`,
    `Your contract and information folder explain the period in which you can cancel after you receive your confirmation, and how. Please read that section and ask me if you have questions.`,
    `## Please confirm`,
    `Please check that what I have written about you is right. If anything is wrong or has changed, tell me before you confirm, so I can correct it.`,
  ].join("\n\n");
}
