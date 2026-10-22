// quote-rules.ts: the Alternatives Considered report built from the quotes compared for one person and one kind of cover. Pure.
// The yearly cost and cost per $1,000 work the same way as src/shared/lib/quotes.ts (a test keeps the two in step).
import type { Block } from "./simple-pdf.ts";

export interface QuoteRow {
  policy_type: string; carrier: string; product: string; coverage_amount: number | string | null; term_years: number | null; premium_amount: number | string | null; premium_frequency: string | null;
  underwriting: string | null; riders: string | null; guarantees: string | null; quote_date: string | null; valid_until: string | null; illustration_url: string | null; notes: string | null;
  status: "considered" | "recommended" | "rejected"; reason: string | null;
}
const PER_YEAR: Record<string, number> = { monthly: 12, quarterly: 4, semi_annual: 2, annual: 1 };
const num = (v: unknown) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 0);
const money = (n: number) => `$${Math.round(n).toLocaleString("en-CA")}`;
const money2 = (n: number) => `$${n.toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const FREQ: Record<string, string> = { monthly: "a month", quarterly: "a quarter", semi_annual: "every 6 months", annual: "a year", single: "one payment" };
export const annualCost = (q: Pick<QuoteRow, "premium_amount" | "premium_frequency">): number | null => { const p = num(q.premium_amount), f = PER_YEAR[q.premium_frequency ?? ""]; return p && f ? p * f : null; };
export const costPer1000 = (q: Pick<QuoteRow, "premium_amount" | "premium_frequency" | "coverage_amount">): number | null => { const a = annualCost(q), c = num(q.coverage_amount); return a && c ? a / (c / 1000) : null; };
const words = (s: string) => s.replace(/_/g, " ");

export function quoteBlocks(i: { person: string; typeLabel: string; quotes: QuoteRow[]; needLine: string | null; preparedOn: string }): Block[] {
  const live = i.quotes.filter((q) => q.status !== "rejected" && costPer1000(q) !== null);
  const low = live.length > 1 ? Math.min(...live.map((q) => costPer1000(q) as number)) : null;
  const order = [...i.quotes].sort((a, b) => (a.status === "recommended" ? -1 : 0) - (b.status === "recommended" ? -1 : 0) || (costPer1000(a) ?? 1e9) - (costPer1000(b) ?? 1e9));
  const rec = i.quotes.find((q) => q.status === "recommended");
  const blocks: Block[] = [
    { kind: "p", small: true, text: `Prepared for ${i.person} by Rolf Issler, BMgt, CLU, ProsperWise Advisors, on ${i.preparedOn}. Quotes are as obtained from each carrier on the dates shown; premiums and underwriting can change at application.` },
    { kind: "h", text: `Options compared: ${i.typeLabel}` },
    ...(i.needLine ? [{ kind: "p" as const, text: i.needLine }] : []),
  ];
  order.forEach((q, n) => {
    const a = annualCost(q), p1 = costPer1000(q), c = num(q.coverage_amount);
    const lines = [
      `Coverage: ${c ? money(c) : "not stated"}${q.term_years ? `, ${q.term_years}-year term` : ""}`,
      `Premium: ${num(q.premium_amount) ? `${money(num(q.premium_amount))} ${FREQ[q.premium_frequency ?? ""] ?? ""}`.trim() : "not stated"}${a && q.premium_frequency !== "annual" ? ` (${money(a)} a year)` : ""}`,
      ...(p1 !== null ? [`Cost per $1,000 of coverage: ${money2(p1)} a year${low !== null && p1 === low && q.status !== "rejected" ? " (lowest of the options still being considered)" : ""}`] : []),
      ...(q.underwriting ? [`Underwriting: ${q.underwriting}`] : []),
      ...(q.riders ? [`Riders and options: ${q.riders}`] : []),
      ...(q.guarantees ? [`Guarantees: ${q.guarantees}`] : []),
      ...(q.quote_date ? [`Quoted ${q.quote_date}${q.valid_until ? `, valid until ${q.valid_until}` : ""}`] : []),
      ...(q.notes ? [q.notes] : []),
      ...(q.reason && q.status !== "considered" ? [`${q.status === "recommended" ? "Why this one" : "Why not"}: ${q.reason}`] : []),
    ];
    blocks.push({ kind: "card", title: `Option ${n + 1}: ${q.carrier}, ${q.product}${q.status === "recommended" ? "  (RECOMMENDED)" : q.status === "rejected" ? "  (not chosen)" : ""}`, lines });
  });
  blocks.push({ kind: "gap", h: 6 }, { kind: "h", text: "Recommendation" });
  blocks.push({ kind: "p", text: rec ? `The ${rec.carrier} ${rec.product} is recommended${rec.reason ? `: ${rec.reason.trim().replace(/[.\s]+$/, "")}.` : "."}` : "No option has been recommended yet." });
  blocks.push({ kind: "p", small: true, text: "Cost per $1,000 of coverage compares options of different sizes; it is not the only thing that matters. Guarantees, riders, underwriting and the carrier's strength also count. This comparison supports a recommendation to the client." });
  return blocks;
}
export { words };
