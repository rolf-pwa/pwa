// Numeric targets stated in a family's Charter (e.g. "Liquidity Reserve of at least $150,000", "Vineyard no more than
// 70% of investable assets") and the code that checks them against the household's balance sheet. The Charter PDF is
// read once by Gemini into CharterTarget rows (exactly as stated); the comparison is done HERE, never by the model.
// Pure: no I/O.

export type TargetArea = "vineyard" | "liquidity" | "strategic" | "philanthropic" | "legacy" | "liabilities" | "other";
/**
 * amount = a BALANCE the family should hold (what a reserve should contain); annual_amount / monthly_amount = a FLOW per
 * year or month (income, spending, a budget line); percent_* / months_of_spending = measured against the balance sheet;
 * other = a rule (an age, a waiting period, a distribution percentage, a threshold that triggers a process).
 */
export type TargetMetric = "amount" | "percent_of_total_assets" | "percent_of_investable_assets" | "percent_of_net_worth" | "months_of_spending" | "annual_amount" | "monthly_amount" | "other";
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
export const TARGET_METRICS: readonly TargetMetric[] = ["amount", "percent_of_total_assets", "percent_of_investable_assets", "percent_of_net_worth", "months_of_spending", "annual_amount", "monthly_amount", "other"];
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
  /** Withdrawn from the accounts so far this year (read from statements); null when not read yet. */
  withdrawnYtd?: number | null;
}

/** info = a rule or a yearly figure shown for context (never changes a status); not_computable = should be measurable but the figures aren't there. */
export type TargetStatus = "met" | "below" | "above" | "info" | "not_computable";

export interface TargetResult extends CharterTarget {
  status: TargetStatus;
  actual: number | null;          // in the metric's unit ($, %, or months)
  actualText: string;
  targetText: string;
  summary: string;                // one plain line for the card
  /** Dollars above (+) or below (-) the target for a checked balance target; 0 when on target; null when not applicable. */
  gapAmount: number | null;
}

const money = (n: number) => `$${Math.round(n).toLocaleString("en-CA")}`;
const fmt = (metric: TargetMetric, n: number) =>
  metric === "amount" ? money(n) : metric === "months_of_spending" ? `${(Math.round(n * 10) / 10).toLocaleString("en-CA")} months` : `${(Math.round(n * 10) / 10).toLocaleString("en-CA")}%`;

const TARGET_TOLERANCE = 0.1; // a stated goal: within 10% counts as met

export function evaluateTarget(t: CharterTarget, b: BalanceFigures): TargetResult {
  const areaValue = t.area === "other" ? null : b.areas[t.area];
  const wording = (verb: string) => `${verb} ${t.value === null ? "?" : fmt(t.metric, t.value)}${t.comparison === "between" && t.value_max !== null ? ` to ${fmt(t.metric, t.value_max)}` : ""}`;
  const targetText = t.comparison === "at_least" ? wording("at least") : t.comparison === "at_most" ? wording("no more than") : t.comparison === "between" ? wording("between") : wording("target");
  const info = (text: string): TargetResult => ({ ...t, status: "info", actual: null, actualText: "", targetText, gapAmount: null, summary: `Charter: ${t.label}${text ? ` ${text}` : ""}.` });

  // Rules (an age, a waiting period, a distribution split, a trigger threshold) can't be checked against a balance.
  if (t.metric === "other" || t.area === "other") {
    const quote = t.quote.length > 140 ? `${t.quote.slice(0, 137)}...` : t.quote;
    return { ...t, status: "info", actual: null, actualText: "", targetText, gapAmount: null, summary: `Charter rule: ${t.label}${quote ? ` — “${quote}”` : ""}.` };
  }

  // Yearly or monthly flows (income, spending, a budget line): never compared with a balance. The yearly income the
  // family draws from the Vineyard is shown against what has been withdrawn so far; only an overdrawn year is flagged.
  if (t.metric === "annual_amount" || t.metric === "monthly_amount") {
    if (t.value === null) return info("");
    const yearly = t.metric === "monthly_amount" ? t.value * 12 : t.value;
    const yearlyText = `${money(yearly)} a year`;
    if (t.area === "vineyard" && b.withdrawnYtd !== null && b.withdrawnYtd !== undefined) {
      const share = yearly > 0 ? Math.round((b.withdrawnYtd / yearly) * 100) : 0;
      const over = b.withdrawnYtd > yearly;
      return {
        ...t, status: over ? "above" : "info", actual: b.withdrawnYtd, actualText: money(b.withdrawnYtd), targetText: yearlyText, gapAmount: null,
        summary: `Charter: ${t.label} (${yearlyText}); ${money(b.withdrawnYtd)} withdrawn so far this year (${share}% of it)${over ? ", already over the yearly figure" : ""}.`,
      };
    }
    return info(`(${yearlyText}; a yearly figure, not compared with a balance)`);
  }

  let actual: number | null = null;
  if (areaValue !== null && t.value !== null) {
    if (t.metric === "amount") actual = areaValue;
    else if (t.metric === "percent_of_total_assets") actual = b.totalAssets > 0 ? (areaValue / b.totalAssets) * 100 : null;
    else if (t.metric === "percent_of_investable_assets") actual = b.investableAssets > 0 ? (areaValue / b.investableAssets) * 100 : null;
    else if (t.metric === "percent_of_net_worth") actual = b.netWorth > 0 ? (areaValue / b.netWorth) * 100 : null;
    else if (t.metric === "months_of_spending") actual = b.monthlySpending && b.monthlySpending > 0 ? areaValue / b.monthlySpending : null;
  }
  if (actual === null || t.value === null) {
    const why = t.metric === "months_of_spending" && !b.monthlySpending ? "monthly spending isn't recorded" : "the figures aren't available";
    return { ...t, status: "not_computable", actual: null, actualText: "", targetText, gapAmount: null, summary: `Charter: ${t.label} (${targetText}); not checked because ${why}.` };
  }

  const lo = t.value, hi = t.value_max ?? t.value;
  // A stated goal for a balance (a reserve amount, months of cover) is a floor: holding more is fine. A goal for a
  // share of assets is a two-sided allocation.
  const floorOnly = t.metric === "amount" || t.metric === "months_of_spending";
  let status: TargetStatus;
  let extra = "";
  if (t.comparison === "at_least") status = actual >= lo ? "met" : "below";
  else if (t.comparison === "at_most") status = actual <= lo ? "met" : "above";
  else if (t.comparison === "between") status = actual < lo ? "below" : actual > hi ? "above" : "met";
  else if (floorOnly) {
    status = actual < lo * (1 - TARGET_TOLERANCE) ? "below" : "met";
    if (actual > lo * (1 + TARGET_TOLERANCE)) extra = `, ${fmt(t.metric, actual - lo)} above the target`;
  } else status = actual < lo * (1 - TARGET_TOLERANCE) ? "below" : actual > lo * (1 + TARGET_TOLERANCE) ? "above" : "met";

  const actualText = fmt(t.metric, actual);
  const verdict = status === "met" ? `met${extra}` : status === "below" ? "short of the target" : "over the limit";

  // Dollars to move to land on the target (above the goal = surplus, below = shortfall). Percent and month targets are
  // converted back to dollars with the same base they were measured against.
  const unitToDollars = t.metric === "amount" ? 1
    : t.metric === "percent_of_total_assets" ? b.totalAssets / 100
    : t.metric === "percent_of_investable_assets" ? b.investableAssets / 100
    : t.metric === "percent_of_net_worth" ? b.netWorth / 100
    : t.metric === "months_of_spending" ? (b.monthlySpending ?? 0) : 0;
  const edge = t.comparison === "between" ? (actual < lo ? lo : actual > hi ? hi : actual) : lo;
  const gapAmount = unitToDollars > 0 ? Math.round((actual - edge) * unitToDollars) : null;
  return { ...t, status, actual, actualText, targetText, gapAmount, summary: `Charter: ${t.label} (${targetText}); actual ${actualText}, ${verdict}.` };
}

export const evaluateTargets = (targets: CharterTarget[], b: BalanceFigures): TargetResult[] => targets.map((t) => evaluateTarget(t, b));
