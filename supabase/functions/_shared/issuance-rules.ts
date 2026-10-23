// issuance-rules.ts: recording an issued policy and closing the loop with the client. Pure.
// The contract is read by the model into a form Rolf reviews; the closing letter is built in (Rolf edits it before it goes) and carries the 10-day right of rescission.
import { nameMatches } from "./insurance-doc-rules.ts";

export const RESCISSION_DAYS = 10;
export const DELIVERY_TITLE = "Your New Policy";
export const DELIVERY_STATEMENT = `I confirm that I have received my policy and this letter, and that I understand I have ${RESCISSION_DAYS} days from receiving the policy to cancel it for a full refund of premiums. I understand that typing my name below is my electronic signature, and that it has the same effect as signing on paper.`;

export const CONTRACT_KEYS = ["carrier", "product", "policy_type", "policy_number", "insured_name", "owner_name", "coverage_amount", "premium_amount", "premium_frequency", "issued_on", "delivered_on", "primary_beneficiary", "contingent_beneficiary"] as const;
const TYPES = ["term", "whole_life", "universal_life", "critical_illness", "disability", "long_term_care", "other"];
const FREQS = ["monthly", "quarterly", "semi_annual", "annual"];

export const CONTRACT_PROMPT = [
  "You are reading an issued life insurance policy contract (or its information page) from a carrier. Extract the facts for this ONE policy.",
  "Rules: copy numbers and names exactly as printed; never calculate or guess; if something is not in the document, leave it out. Dollar amounts are plain numbers without $ or commas. Dates are YYYY-MM-DD.",
  `For each fact give: key (one of ${CONTRACT_KEYS.join(", ")}), value, and quote (an exact copy of 8 to 200 characters from the document that supports it). One fact per key.`,
  "Meanings: policy_number is the policy or contract number. issued_on is the policy date or date of issue (not the application date). delivered_on is the date the policy was delivered, only if the document states it. coverage_amount is the total face amount. premium_amount is the regular premium and premium_frequency how often it is paid (monthly, quarterly, semi_annual or annual). insured_name and owner_name are the life insured and the policy owner. policy_type is one of: " + TYPES.join(", ") + ".",
].join("\n");

const num = (v: unknown) => { const n = Number(String(v ?? "").replace(/[$,\s]/g, "")); return Number.isFinite(n) && n > 0 ? n : null; };
const text = (v: unknown, n = 300) => String(v ?? "").trim().slice(0, n);
const iso = (v: string) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "");

export interface IssuanceDraft { carrier: string; product: string; policy_type: string; policy_number: string; coverage_amount: string; premium_amount: string; premium_frequency: string; issued_on: string; delivered_on: string; primary_beneficiary: string }
export interface ParsedContract { draft: IssuanceDraft; sources: Record<string, string>; warnings: string[]; contingent: string }

export function draftFromContract(raw: unknown, personName: string): ParsedContract {
  const by = new Map<string, { value: string; quote: string }>();
  for (const r of (Array.isArray(raw) ? raw : []) as any[]) {
    const key = String(r?.key ?? "");
    if ((CONTRACT_KEYS as readonly string[]).includes(key) && !by.has(key) && text(r?.value)) by.set(key, { value: text(r.value), quote: text(r?.quote, 300) });
  }
  const v = (k: string) => by.get(k)?.value ?? "";
  const sources: Record<string, string> = {};
  const src = (field: string, key = field) => { const q = by.get(key)?.quote; if (q) sources[field] = q; };
  const warnings: string[] = [];
  const type = TYPES.includes(v("policy_type")) ? v("policy_type") : "other";
  if (!TYPES.includes(v("policy_type"))) warnings.push("I could not tell what kind of policy this is. Choose it.");
  if (!v("policy_number")) warnings.push("I could not find the policy number.");
  if (!num(v("coverage_amount"))) warnings.push("I could not find the coverage amount.");
  if (!iso(v("issued_on"))) warnings.push("I could not find the date the policy was issued.");
  const people = [v("insured_name"), v("owner_name")].filter(Boolean);
  if (!people.length) warnings.push("I could not find who the policy is for. Check it is the right person.");
  else if (personName && !people.some((n) => nameMatches(n, personName))) warnings.push(`This policy is for ${people.join(" / ")}, not ${personName}. Check you picked the right person before saving.`);
  const freq = FREQS.includes(v("premium_frequency")) ? v("premium_frequency") : "monthly";
  if (num(v("premium_amount")) && !FREQS.includes(v("premium_frequency"))) warnings.push("I assumed the premium is monthly. Check how often it is paid.");
  for (const k of ["carrier", "product", "policy_number", "coverage_amount", "premium_amount", "premium_frequency", "issued_on", "delivered_on", "primary_beneficiary"]) src(k);
  src("policy_type");
  return {
    draft: { carrier: v("carrier"), product: v("product"), policy_type: type, policy_number: v("policy_number"), coverage_amount: num(v("coverage_amount")) ? String(num(v("coverage_amount"))) : "", premium_amount: num(v("premium_amount")) ? String(num(v("premium_amount"))) : "", premium_frequency: freq, issued_on: iso(v("issued_on")), delivered_on: iso(v("delivered_on")), primary_beneficiary: v("primary_beneficiary") },
    sources, warnings, contingent: v("contingent_beneficiary"),
  };
}

// ── The closing letter ─────────────────────────────────────────────────────────────────────────────────────────────────
const money = (n: number) => `$${(Number.isInteger(n) ? n.toLocaleString("en-CA") : n.toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 }))}`;
const PER: Record<string, string> = { monthly: "a month", quarterly: "a quarter", semi_annual: "every six months", annual: "a year" };
const longDate = (ymd: string) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString("en-CA", { timeZone: "UTC", dateStyle: "long" });
const words = (s: string) => s.replace(/_/g, " ");

export interface LetterInput { firstNames: string; carrier: string; product: string; policy_type: string; policy_number: string; coverage_amount?: number | null; premium_amount?: number | null; premium_frequency?: string | null; issued_on?: string | null; delivered_on?: string | null; primary_beneficiary?: string | null }

/** The built-in closing letter. Rolf edits it before it is sent. */
export function deliveryLetterMarkdown(i: LetterInput): string {
  const facts = [
    `${i.carrier} ${i.product}`,
    `policy number ${i.policy_number}`,
    i.issued_on ? `issued ${longDate(i.issued_on)}` : "",
    i.coverage_amount ? `${money(i.coverage_amount)} of coverage` : "",
    i.premium_amount ? `premium ${money(i.premium_amount)} ${PER[i.premium_frequency ?? ""] ?? ""}`.trim() : "",
    i.primary_beneficiary ? `primary beneficiary ${i.primary_beneficiary}` : "",
  ].filter(Boolean).join(", ");
  return [
    `Hi ${i.firstNames},`,
    `Your ${words(i.policy_type)} policy has been issued. ${i.delivered_on ? `${i.carrier} delivered it to you electronically on ${longDate(i.delivered_on)}.` : `${i.carrier} has delivered it to you electronically.`}`,
    `**Your policy.**  ${facts}.`,
    "**Please read it.**  Check that your name, your date of birth, the coverage, the premium and your beneficiaries are all correct. If anything is not right, tell me straight away so it can be corrected.",
    `**Your ${RESCISSION_DAYS}-day right of rescission.**  If the policy is not satisfactory for any reason, you have ${RESCISSION_DAYS} days from the day you received it to cancel it and receive a full refund of the premiums you paid. To cancel, tell me or ${i.carrier} in writing within that time. The policy explains how.`,
    "**Keeping it right.**  If your circumstances change, for example a new child, a change of work, a move or a new loan, tell me so we can keep your coverage in step with your life.",
    "Thank you for trusting me with this. Please confirm below that you have received your policy and this letter.",
    "Regards,\n\nRolf Issler, BMgt, CLU\n\nFinancial Planner\n\nProsperWise Advisors",
  ].join("\n\n");
}
