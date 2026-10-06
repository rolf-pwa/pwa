// Numeric targets stated in a family's Charter (e.g. "Liquidity Reserve of at least $150,000", "Vineyard no more than
// 70% of investable assets") and the code that checks them against the household's balance sheet. The Charter PDF is
// read once by Gemini into CharterTarget rows (exactly as stated); the comparison is done HERE, never by the model.
// Pure: no I/O.

export type TargetArea = "vineyard" | "liquidity" | "strategic" | "philanthropic" | "legacy" | "liabilities" | "other";
export type TargetMetric = "amount" | "percent_of_total_assets" | "percent_of_investable_assets" | "percent_of_net_worth" | "months_of_spending" | "other";
export type TargetComparison = "at_least" | "at_most" | "target" | "between";

export interface CharterTarget {
  area: TargetArea;
  label: string;
  metric: TargetMetric;
  comparison: TargetComparison;
  value: number | null;
  value_max: number | null;
  quote: string;
}

export const TARGET_AREAS: readonly TargetArea[] = ["vineyard", "liquidity", "strategic", "philanthropic", "legacy", "liabilities", "other"];
export const TARGET_METRICS: readonly TargetMetric[] = ["amount", "percent_of_total_assets", "percent_of_investable_assets", "percent_of_net_worth", "months_of_spending", "other"];
export const TARGET_COMPARISONS: readonly TargetComparison[] = ["at_least", "at_most", "target", "between"];

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const clip = (v: unknown, n: number) => String(v ?? "").trim().slice(0, n);

/** Validates model output: anything malformed is dropped or nulled, never repaired by guessing. */
export function sanitizeTargets(raw: unknown): CharterTarget[] {
  if (!Array.isArray(raw)) return [];
  const out: CharterTarget[] = [];
  for (const t of raw) {
    if (!t || typeof t !== "object") continue;
    const r = t as Record<string, unknown>;
    const area = TARGET_AREAS.includes(r.area as TargetArea) ? (r.area as TargetArea) : "other";
    const metric = TARGET_METRICS.includes(r.metric as TargetMetric) ? (r.metric as TargetMetric) : "other";
    const comparison = TARGET_COMPARISONS.includes(r.comparison as TargetComparison) ? (r.comparison as TargetComparison) : "target";
    const label = clip(r.label, 120);
    if (!label) continue;
    out.push({
      area, label, metric, comparison,
      value: isNum(r.value) ? r.value : null,
      value_max: isNum(r.value_max) ? r.value_max : null,
      quote: clip(r.quote, 240),
    });
    if (out.length >= 20) break;
  }
  return out;
}

export interface BalanceFigures {
  areas: { vineyard: number; liquidity: number; strategic: number; philanthropic: number; legacy: number; liabilities: number };
  totalAssets: number;
  /** Total assets less real estate: what the family could actually invest or draw on. */
  investableAssets: number;
  netWorth: number;
  /** Monthly household spending, when the Charter (or the records) state it. */
  monthlySpending: number | null;
}

export type TargetStatus = "met" | "below" | "above" | "not_computable";

export interface TargetResult extends CharterTarget {
  status: TargetStatus;
  actual: number | null;          // in the metric's unit ($, %, or months)
  actualText: string;
  targetText: string;
  summary: string;                // one plain line for the card
}

const money = (n: number) => `$${Math.round(n).toLocaleString("en-CA")}`;
const fmt = (metric: TargetMetric, n: number) =>
  metric === "amount" ? money(n) : metric === "months_of_spending" ? `${(Math.round(n * 10) / 10).toLocaleString("en-CA")} months` : `${(Math.round(n * 10) / 10).toLocaleString("en-CA")}%`;

const TARGET_TOLERANCE = 0.1; // "target" (no minimum/maximum): within 10% counts as met

export function evaluateTarget(t: CharterTarget, b: BalanceFigures): TargetResult {
  const areaValue = t.area === "other" ? null : b.areas[t.area];
  const wording = (verb: string) => `${verb} ${t.value === null ? "?" : fmt(t.metric, t.value)}${t.comparison === "between" && t.value_max !== null ? ` to ${fmt(t.metric, t.value_max)}` : ""}`;
  const targetText = t.comparison === "at_least" ? wording("at least") : t.comparison === "at_most" ? wording("no more than") : t.comparison === "between" ? wording("between") : wording("target");

  let actual: number | null = null;
  if (areaValue !== null && t.value !== null) {
    if (t.metric === "amount") actual = areaValue;
    else if (t.metric === "percent_of_total_assets") actual = b.totalAssets > 0 ? (areaValue / b.totalAssets) * 100 : null;
    else if (t.metric === "percent_of_investable_assets") actual = b.investableAssets > 0 ? (areaValue / b.investableAssets) * 100 : null;
    else if (t.metric === "percent_of_net_worth") actual = b.netWorth > 0 ? (areaValue / b.netWorth) * 100 : null;
    else if (t.metric === "months_of_spending") actual = b.monthlySpending && b.monthlySpending > 0 ? areaValue / b.monthlySpending : null;
  }
  if (actual === null || t.value === null) {
    const why = t.metric === "months_of_spending" && !b.monthlySpending ? "monthly spending isn't recorded" : t.metric === "other" || t.area === "other" ? "it can't be measured from the balance sheet" : "the figures aren't available";
    return { ...t, status: "not_computable", actual: null, actualText: "", targetText, summary: `Charter: ${t.label} (${targetText}); not checked because ${why}.` };
  }

  const lo = t.value, hi = t.value_max ?? t.value;
  let status: TargetStatus;
  if (t.comparison === "at_least") status = actual >= lo ? "met" : "below";
  else if (t.comparison === "at_most") status = actual <= lo ? "met" : "above";
  else if (t.comparison === "between") status = actual < lo ? "below" : actual > hi ? "above" : "met";
  else status = actual < lo * (1 - TARGET_TOLERANCE) ? "below" : actual > lo * (1 + TARGET_TOLERANCE) ? "above" : "met";

  const actualText = fmt(t.metric, actual);
  const verdict = status === "met" ? "met" : status === "below" ? `short of the target` : `over the limit`;
  return { ...t, status, actual, actualText, targetText, summary: `Charter: ${t.label} (${targetText}); actual ${actualText}, ${verdict}.` };
}

export const evaluateTargets = (targets: CharterTarget[], b: BalanceFigures): TargetResult[] => targets.map((t) => evaluateTarget(t, b));
