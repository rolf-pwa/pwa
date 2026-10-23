// illustration-rules.ts: turning what the model read from a carrier's illustration into the fields of a quote, with the checks that matter. Pure.
// The model proposes; Rolf reviews every field before anything is saved. The quote's premium is the MINIMUM (cost of cover) premium where the illustration
// has one, because a universal life illustration is often built on a larger savings premium that would make the cost per $1,000 look worse than it is.
import { nameMatches } from "./insurance-doc-rules.ts";

export const ILLUSTRATION_KEYS = ["carrier", "product", "policy_type", "insured_name", "coverage_amount", "term_years", "premium_minimum", "premium_illustrated", "premium_frequency", "premium_payment_years", "underwriting", "riders", "guarantees", "death_benefit_option", "quote_date", "notes", "benefit_kind", "waiting_days", "benefit_period", "occupation"] as const;
export type IllustrationKey = (typeof ILLUSTRATION_KEYS)[number];
const TYPES = ["term", "whole_life", "universal_life", "critical_illness", "disability", "long_term_care", "other"];
const FREQS = ["monthly", "quarterly", "semi_annual", "annual"];

export const ILLUSTRATION_PROMPT = [
  "You are reading a life, critical illness or disability insurance illustration or quote from a carrier, prepared by an advisor for a client. Extract the facts for ONE quote.",
  "Rules: copy numbers exactly as printed; never calculate or guess; if something is not in the document, leave it out. Dollar amounts are plain numbers without $ or commas. Dates are YYYY-MM-DD.",
  `For each fact give: key (one of ${ILLUSTRATION_KEYS.join(", ")}), value, and quote (an exact copy of 8 to 200 characters from the document that supports it). One fact per key.`,
  "Meanings: coverage_amount is the total face amount of insurance (add the coverages if several are listed, and say so in notes). term_years is the length of protection for a term policy; leave it out when protection is for life. premium_minimum is the minimum or required premium for the insurance (for universal life, the minimum premium); premium_illustrated is the premium the illustration is actually built on, only if it differs from the minimum (for example a universal life selected premium, or a participating policy premium plus additional deposit contributions; additional deposits and savings are NOT part of premium_minimum). premium_frequency is monthly, quarterly, semi_annual or annual. premium_payment_years is how many years premiums are payable. underwriting describes the rating basis shown, such as tobacco use, sex and insurance age. riders lists riders and optional coverages with their cost. guarantees lists what the document says is guaranteed, and for a participating policy says that dividends are not guaranteed. death_benefit_option is the death benefit choice. quote_date is the date the illustration was prepared. policy_type is one of: " + TYPES.join(", ") + ".",
  // Critical illness and disability.
  "For critical illness: coverage_amount is the lump sum (add the coverages if several are listed); term_years is the length of protection when it is a term in years (leave it out for to-age or permanent cover); guarantees lists the number of conditions covered, benefits such as a prevention or early-stage benefit, and renewability or convertibility; premium_minimum is the base premium for the cover, without policy fees (put policy fees in notes) and without optional add-ons (list those in riders with their cost).",
  "For disability: coverage_amount is the MONTHLY benefit; waiting_days is the number of days before benefits start; benefit_period is how long benefits are paid, as printed (for example 2 years, 5 years, to age 65); occupation is the occupation definition and its period as printed (for example regular occupation 2 years); benefit_kind is overhead for business overhead expense cover and income otherwise; premium_minimum is the base monthly premium for that coverage, without policy fees (put them in notes) and without optional add-ons such as partial disability or return of premiums (list those in riders with their cost). Say in product whether the coverage is for accident, for illness, or overhead expense.",
  "Some illustrations price several separate coverages (for example disability for accident, disability for illness, and overhead expense). Give each its own number in coverage (1, 2, 3...) and give every fact of that coverage that number. Facts that apply to all coverages (carrier, insured_name, quote_date) go under coverage 0. With a single coverage use 1.",
].join("\n");

const num = (v: unknown) => { const n = Number(String(v ?? "").replace(/[$,\s]/g, "")); return Number.isFinite(n) && n > 0 ? n : null; };
const text = (v: unknown, n = 600) => String(v ?? "").trim().slice(0, n);
const money = (n: number) => `$${Math.round(n * 100) % 100 === 0 ? Math.round(n).toLocaleString("en-CA") : n.toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const PER: Record<string, string> = { monthly: "a month", quarterly: "a quarter", semi_annual: "every six months", annual: "a year" };

export interface QuoteDraft { benefit_kind: string; waiting_days: string; benefit_period: string; occupation: string; policy_type: string; carrier: string; product: string; coverage_amount: string; term_years: string; premium_amount: string; premium_frequency: string; underwriting: string; riders: string; guarantees: string; quote_date: string; valid_until: string; illustration_url: string; notes: string }
export interface ParsedIllustration { draft: QuoteDraft; sources: Record<string, string>; warnings: string[] }

/** The model's facts, as a quote form to review, with the quote behind each field and anything that needs a second look. */
export function draftFromIllustration(raw: unknown, personName: string, illustrationUrl: string): ParsedIllustration {
  const by = new Map<string, { value: string; quote: string }>();
  for (const r of (Array.isArray(raw) ? raw : []) as any[]) {
    const key = String(r?.key ?? "");
    if ((ILLUSTRATION_KEYS as readonly string[]).includes(key) && !by.has(key) && text(r?.value)) by.set(key, { value: text(r.value), quote: text(r?.quote, 300) });
  }
  const v = (k: IllustrationKey) => by.get(k)?.value ?? "";
  const warnings: string[] = [];
  const sources: Record<string, string> = {};
  const src = (field: string, ...keys: IllustrationKey[]) => { const q = keys.map((k) => by.get(k)?.quote).find(Boolean); if (q) sources[field] = q; };

  const type = TYPES.includes(v("policy_type")) ? v("policy_type") : "other";
  const dis = type === "disability";
  const waiting = v("waiting_days").replace(/\s*days?$/i, "");
  const waitingOk = /^\d{1,3}$/.test(waiting);
  if (dis && !waitingOk) warnings.push("I could not find the waiting period. Check it.");
  if (dis && !v("benefit_period")) warnings.push("I could not find the benefit period. Check it.");
  if (!TYPES.includes(v("policy_type"))) warnings.push("I could not tell what kind of policy this is. Choose it.");
  const min = num(v("premium_minimum")), shown = num(v("premium_illustrated"));
  const premium = min ?? shown;
  const freq = FREQS.includes(v("premium_frequency")) ? v("premium_frequency") : "monthly";
  if (premium && !FREQS.includes(v("premium_frequency"))) warnings.push("I assumed the premium is monthly. Check how often it is paid.");
  if (!premium) warnings.push("I could not find the premium.");
  if (!num(v("coverage_amount"))) warnings.push(dis ? "I could not find the monthly benefit." : "I could not find the coverage amount.");
  if (min && shown && Math.abs(shown - min) > 0.005) warnings.push(`The illustration is built on ${money(shown)} ${PER[freq]}, more than the minimum ${money(min)}. The quote uses the minimum (the cost of the cover) so options compare fairly. The difference is noted below.`);
  const insured = v("insured_name");
  if (insured && personName && !nameMatches(insured, personName)) warnings.push(`This illustration is for ${insured}, not ${personName}. Check you picked the right person before saving.`);
  if (!insured) warnings.push("I could not find who the illustration is for. Check it is the right person.");

  const notes = [
    v("notes"),
    min && shown && Math.abs(shown - min) > 0.005 ? `The illustration is built on a ${money(shown)} ${PER[freq]} premium, which includes saving or additional deposits above the minimum.` : "",
    num(v("premium_payment_years")) ? `Premiums payable for ${num(v("premium_payment_years"))} years.` : "",
    v("death_benefit_option") ? `Death benefit option: ${v("death_benefit_option")}.` : "",
  ].filter(Boolean).join(" ");
  const date = /^\d{4}-\d{2}-\d{2}$/.test(v("quote_date")) ? v("quote_date") : "";
  src("carrier", "carrier"); src("product", "product"); src("policy_type", "policy_type"); src("coverage_amount", "coverage_amount"); src("term_years", "term_years");
  src("premium_amount", "premium_minimum", "premium_illustrated"); src("underwriting", "underwriting"); src("riders", "riders"); src("guarantees", "guarantees"); src("quote_date", "quote_date"); src("notes", "death_benefit_option", "premium_payment_years", "notes"); src("waiting_days", "waiting_days"); src("benefit_period", "benefit_period"); src("occupation", "occupation"); src("benefit_kind", "benefit_kind");
  return {
    draft: { benefit_kind: dis && v("benefit_kind") === "overhead" ? "overhead" : dis ? "income" : "", waiting_days: dis && waitingOk ? waiting : "", benefit_period: dis ? v("benefit_period") : "", occupation: dis ? v("occupation") : "", policy_type: type, carrier: v("carrier"), product: v("product"), coverage_amount: num(v("coverage_amount")) ? String(num(v("coverage_amount"))) : "", term_years: num(v("term_years")) ? String(Math.round(num(v("term_years"))!)) : "", premium_amount: premium ? String(premium) : "", premium_frequency: freq, underwriting: v("underwriting"), riders: v("riders"), guarantees: v("guarantees"), quote_date: date, valid_until: "", illustration_url: illustrationUrl, notes },
    sources, warnings,
  };
}

/**
 * Everything the model read, as one quote form per coverage. Facts numbered 0 apply to every coverage; an illustration with one coverage gives one form.
 * Facts with no number count as coverage 1.
 */
export function draftsFromIllustration(raw: unknown, personName: string, illustrationUrl: string): ParsedIllustration[] {
  const facts = (Array.isArray(raw) ? raw : []) as any[];
  const cov = (f: any) => { const n = Math.round(Number(f?.coverage)); return Number.isFinite(n) && n >= 0 ? n : 1; };
  const shared = facts.filter((f) => cov(f) === 0);
  const numbers = [...new Set(facts.map(cov).filter((n) => n > 0))].sort((a, b) => a - b);
  if (!numbers.length) return [draftFromIllustration(shared, personName, illustrationUrl)];
  return numbers.slice(0, 6).map((n) => draftFromIllustration([...facts.filter((f) => cov(f) === n), ...shared], personName, illustrationUrl));
}
