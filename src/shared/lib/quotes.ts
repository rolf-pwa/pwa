// quotes.ts: comparing carrier quotes. Pure. Mirrors supabase/functions/_shared/quote-rules.ts (a test keeps the two in step).
export interface Quote {
  id: string; policy_type: string; carrier: string; product: string; coverage_amount: number | string | null; term_years: number | null;
  premium_amount: number | string | null; premium_frequency: string | null; underwriting: string | null; riders: string | null; guarantees: string | null;
  quote_date: string | null; valid_until: string | null; illustration_url: string | null; notes: string | null; status: "considered" | "recommended" | "rejected"; reason: string | null;
}
const PER_YEAR: Record<string, number> = { monthly: 12, quarterly: 4, semi_annual: 2, annual: 1 };
const num = (v: unknown) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 0);
export const money2 = (n: number) => `$${n.toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const money = (n: number) => `$${Math.round(n).toLocaleString("en-CA")}`;
export const FREQ_LABEL: Record<string, string> = { monthly: "a month", quarterly: "a quarter", semi_annual: "every 6 months", annual: "a year", single: "one payment" };

/** What the premium costs over a year; a single premium has no yearly cost to compare. */
export const annualCost = (q: Pick<Quote, "premium_amount" | "premium_frequency">): number | null => { const p = num(q.premium_amount), f = PER_YEAR[q.premium_frequency ?? ""]; return p && f ? p * f : null; };
/** Dollars a year for each $1,000 of coverage: the fair way to compare quotes of different sizes. */
export const costPer1000 = (q: Pick<Quote, "premium_amount" | "premium_frequency" | "coverage_amount">): number | null => { const a = annualCost(q), c = num(q.coverage_amount); return a && c ? a / (c / 1000) : null; };

export interface Row { quote: Quote; annual: number | null; per1000: number | null; cheapest: boolean }
/** Quotes of one kind with their yearly cost and cost per $1,000, the cheapest (not rejected) marked. */
export function compare(quotes: Quote[]): Row[] {
  const rows = quotes.map((quote) => ({ quote, annual: annualCost(quote), per1000: costPer1000(quote), cheapest: false }));
  const live = rows.filter((r) => r.quote.status !== "rejected" && r.per1000 !== null);
  const low = live.length ? Math.min(...live.map((r) => r.per1000 as number)) : null;
  return rows.map((r) => ({ ...r, cheapest: low !== null && r.quote.status !== "rejected" && r.per1000 === low && live.length > 1 }));
}
const describe = (q: Quote) => {
  const c = num(q.coverage_amount), p = num(q.premium_amount);
  return `${q.carrier} ${q.product}${c ? ` for ${money(c)}` : ""}${p ? ` at ${money(p)} ${FREQ_LABEL[q.premium_frequency ?? ""] ?? ""}`.trimEnd() : ""}`;
};
/** The "alternatives we considered" sentences for the reason-why letter: the other options, then why the recommended one. */
export function alternativesText(quotes: Quote[]): string {
  const rec = quotes.find((q) => q.status === "recommended");
  const others = quotes.filter((q) => q.status !== "recommended");
  if (!rec && !others.length) return "";
  const parts: string[] = [];
  if (others.length) parts.push(`We compared ${others.length + (rec ? 1 : 0)} options: ${[...others, ...(rec ? [rec] : [])].map(describe).join("; ")}.`);
  if (rec?.reason?.trim()) parts.push(`We recommend the ${rec.carrier} ${rec.product} because ${rec.reason.trim().replace(/^because\s+/i, "").replace(/[.\s]+$/, "")}.`);
  return parts.join(" ");
}
