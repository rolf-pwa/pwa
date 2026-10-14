// portfolio-review.ts: the numbers behind a Portfolio Review pack. Pure (no I/O) so it can be unit-tested.
//
// Three sources meet here: the monthly import (each account's value and returns), the statements read in the Vault scan (each
// account's funds, with the category printed on the statement), and the client's Investor Profile (the target mix). The comparison
// is done in code, never by a model.

export type AssetClass = "income" | "canadian_equity" | "us_intl_equity" | "equity_other" | "other";
export const EQUITY_CLASSES: AssetClass[] = ["canadian_equity", "us_intl_equity", "equity_other"];
export const CLASS_LABEL: Record<AssetClass, string> = {
  income: "Income", canadian_equity: "Canadian equity", us_intl_equity: "U.S. and international equity", equity_other: "Other equity", other: "Not classified",
};

/** A fund's asset class, from the category heading printed on the statement (and its name when the category is missing or vague). */
export function classifyFund(category: string | null | undefined, name?: string | null): AssetClass {
  const c = String(category ?? "").toLowerCase();
  const n = String(name ?? "").toLowerCase();
  const text = c || n;
  if (/income|fixed|bond|money market|cash|mortgage|guaranteed|term deposit/.test(text)) return "income";
  if (/canad/.test(text) && /equity|stock|dividend|growth/.test(text)) return "canadian_equity";
  if (/(u\.?s\.?|international|global|foreign|emerging|world|europe|asia)/.test(text) && /equity|stock|growth/.test(text)) return "us_intl_equity";
  if (/equity|stock|dividend|growth/.test(text)) return "equity_other";
  // The category said nothing useful: try the fund's own name.
  if (c && n) return classifyFund(null, n);
  return "other";
}

export interface FundRow { name: string; category: string | null; value: number }
export interface StatementFunds { statementDate: string | null; funds: FundRow[]; sourceFile?: string | null }
export interface Returns { ytd: number | null; sixMonth: number | null; oneYear: number | null; threeYear: number | null; fiveYear: number | null; sinceInception: number | null }

export interface PackAccount {
  id: string;
  name: string;
  number: string | null;
  type: string | null;
  custodian: string | null;
  owner: string | null;
  value: number | null;
  boyValue: number | null;
  asOf: string | null;
  returns: Returns;
  /** The previous month's value, when we have it. */
  priorValue: number | null;
  priorAsOf: string | null;
  statement: StatementFunds | null;
}

export interface InvestorProfile { accountNumber: string | null; label: string | null; incomePct: number | null; equityPct: number | null; bandPct: number; asOf?: string | null; source?: string | null }

export type DriftStatus = "within" | "too_much_income" | "too_little_income" | "no_target" | "no_data";
export interface Drift { status: DriftStatus; targetIncomePct: number | null; actualIncomePct: number | null; bandPct: number; /** Dollars to move out of income (positive) or into income (negative) to reach target. */ moveToIncome: number | null }

export interface ClassTotals { income: number; canadian_equity: number; us_intl_equity: number; equity_other: number; other: number }
const zeroTotals = (): ClassTotals => ({ income: 0, canadian_equity: 0, us_intl_equity: 0, equity_other: 0, other: 0 });

export function classTotals(funds: FundRow[]): ClassTotals {
  const t = zeroTotals();
  for (const f of funds) t[classifyFund(f.category, f.name)] += Number.isFinite(f.value) ? f.value : 0;
  return t;
}
const sum = (t: ClassTotals) => t.income + t.canadian_equity + t.us_intl_equity + t.equity_other + t.other;
const equityOf = (t: ClassTotals) => t.canadian_equity + t.us_intl_equity + t.equity_other;

/** Compares an income share with a target and band. The share is of what the statement shows (income + equity); unclassified funds are left out. */
export function driftFor(t: ClassTotals, profile: Pick<InvestorProfile, "incomePct" | "bandPct"> | null): Drift {
  const base = t.income + equityOf(t);
  if (base <= 0) return { status: "no_data", targetIncomePct: profile?.incomePct ?? null, actualIncomePct: null, bandPct: profile?.bandPct ?? 5, moveToIncome: null };
  const actual = (t.income / base) * 100;
  if (!profile || profile.incomePct === null) return { status: "no_target", targetIncomePct: null, actualIncomePct: round1(actual), bandPct: profile?.bandPct ?? 5, moveToIncome: null };
  const diff = actual - profile.incomePct;
  const status: DriftStatus = Math.abs(diff) <= profile.bandPct ? "within" : diff > 0 ? "too_much_income" : "too_little_income";
  return { status, targetIncomePct: profile.incomePct, actualIncomePct: round1(actual), bandPct: profile.bandPct, moveToIncome: Math.round(((profile.incomePct - actual) / 100) * base) };
}
const round1 = (n: number) => Math.round(n * 10) / 10;

export interface PackException { severity: "attention" | "note"; text: string }
export interface PackAccountOut extends PackAccount {
  changeSincePrior: number | null; changeSincePriorPct: number | null; changeYtd: number | null;
  classTotals: ClassTotals | null; incomePct: number | null; drift: Drift; statementAgeDays: number | null;
}
export interface Pack {
  asOf: string | null;
  totalValue: number;
  accounts: PackAccountOut[];
  household: { classTotals: ClassTotals; coveredValue: number; coveragePct: number | null; drift: Drift; valueWeightedYtd: number | null; changeSincePrior: number | null; changeYtd: number | null };
  profile: { household: InvestorProfile | null; byAccount: number };
  exceptions: PackException[];
  gaps: string[];
}

export const STATEMENT_STALE_DAYS = 120;
export const BAD_YTD_PCT = -10;
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
const money = (n: number) => n.toLocaleString("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 });
const norm = (s: string | null | undefined) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

export function buildPortfolioPack(input: { accounts: PackAccount[]; profiles: InvestorProfile[]; today: string }): Pack {
  const { accounts, profiles, today } = input;
  const householdProfile = profiles.find((p) => !p.accountNumber) ?? null;
  const profileFor = (a: PackAccount): InvestorProfile | null => profiles.find((p) => p.accountNumber && norm(p.accountNumber) === norm(a.number)) ?? householdProfile;

  const out: PackAccountOut[] = accounts.map((a) => {
    const t = a.statement && a.statement.funds.length ? classTotals(a.statement.funds) : null;
    const base = t ? t.income + equityOf(t) : 0;
    const prof = profileFor(a);
    return {
      ...a,
      changeSincePrior: a.value !== null && a.priorValue !== null ? a.value - a.priorValue : null,
      changeSincePriorPct: a.value !== null && a.priorValue !== null && a.priorValue > 0 ? ((a.value - a.priorValue) / a.priorValue) * 100 : null,
      changeYtd: a.value !== null && a.boyValue !== null ? a.value - a.boyValue : null,
      classTotals: t,
      incomePct: t && base > 0 ? round1((t.income / base) * 100) : null,
      drift: t ? driftFor(t, prof) : { status: "no_data", targetIncomePct: prof?.incomePct ?? null, actualIncomePct: null, bandPct: prof?.bandPct ?? 5, moveToIncome: null },
      statementAgeDays: a.statement?.statementDate ? daysBetween(a.statement.statementDate, today) : null,
    };
  });

  const totalValue = out.reduce((s, a) => s + (a.value ?? 0), 0);
  const covered = out.filter((a) => a.classTotals);
  const hhTotals = zeroTotals();
  for (const a of covered) for (const k of Object.keys(hhTotals) as AssetClass[]) hhTotals[k] += a.classTotals![k];
  const coveredValue = covered.reduce((s, a) => s + (a.value ?? sum(a.classTotals!)), 0);

  // The household's target: its own profile, or, when only some accounts have their own, each account's target weighted by its share.
  let hhDrift: Drift;
  if (householdProfile) hhDrift = driftFor(hhTotals, householdProfile);
  else if (covered.some((a) => profileFor(a))) {
    const withTarget = covered.filter((a) => profileFor(a)?.incomePct != null);
    const weight = withTarget.reduce((s, a) => s + (a.value ?? 0), 0);
    const tgt = weight > 0 ? withTarget.reduce((s, a) => s + (profileFor(a)!.incomePct as number) * (a.value ?? 0), 0) / weight : null;
    hhDrift = driftFor(hhTotals, tgt === null ? null : { incomePct: round1(tgt), bandPct: 5 });
  } else hhDrift = driftFor(hhTotals, null);

  const ytdW = out.filter((a) => a.returns.ytd !== null && (a.value ?? 0) > 0);
  const wsum = ytdW.reduce((s, a) => s + (a.value ?? 0), 0);
  const valueWeightedYtd = wsum > 0 ? round1(ytdW.reduce((s, a) => s + (a.returns.ytd as number) * (a.value ?? 0), 0) / wsum) : null;
  const priorKnown = out.filter((a) => a.changeSincePrior !== null);
  const ytdKnown = out.filter((a) => a.changeYtd !== null);

  const exceptions: PackException[] = [];
  const gaps: string[] = [];
  for (const a of out) {
    const label = a.name || a.number || "An account";
    if (a.returns.ytd !== null && a.returns.ytd <= BAD_YTD_PCT) exceptions.push({ severity: "attention", text: `${label} is down ${Math.abs(a.returns.ytd).toFixed(1)}% year to date.` });
    if (a.changeSincePriorPct !== null && Math.abs(a.changeSincePriorPct) > 25) exceptions.push({ severity: "attention", text: `${label} moved ${a.changeSincePriorPct > 0 ? "up" : "down"} ${Math.abs(a.changeSincePriorPct).toFixed(1)}% in a month. Check for a deposit or withdrawal.` });
    if (a.drift.status === "too_much_income") exceptions.push({ severity: "attention", text: `${label} holds ${a.drift.actualIncomePct}% income against a ${a.drift.targetIncomePct}% target (${money(Math.abs(a.drift.moveToIncome ?? 0))} to move into equity).` });
    if (a.drift.status === "too_little_income") exceptions.push({ severity: "attention", text: `${label} holds ${a.drift.actualIncomePct}% income against a ${a.drift.targetIncomePct}% target (${money(Math.abs(a.drift.moveToIncome ?? 0))} to move into income).` });
    if (a.statementAgeDays !== null && a.statementAgeDays > STATEMENT_STALE_DAYS) exceptions.push({ severity: "note", text: `${label}: the latest statement read is ${a.statementAgeDays} days old (${a.statement!.statementDate}).` });
    if (!a.statement || !a.statement.funds.length) gaps.push(`No fund detail for ${label}. Scan its latest statement to include it in the allocation.`);
  }
  if (!householdProfile && !out.some((a) => profileFor(a))) gaps.push("No Investor Profile on file. Add the target mix to compare against.");
  if (!out.length) gaps.push("No managed accounts found for this household.");

  return {
    asOf: out.map((a) => a.asOf).filter(Boolean).sort().pop() ?? null,
    totalValue,
    accounts: out,
    household: {
      classTotals: hhTotals, coveredValue, coveragePct: totalValue > 0 ? round1((coveredValue / totalValue) * 100) : null, drift: hhDrift, valueWeightedYtd,
      changeSincePrior: priorKnown.length ? priorKnown.reduce((s, a) => s + (a.changeSincePrior as number), 0) : null,
      changeYtd: ytdKnown.length ? ytdKnown.reduce((s, a) => s + (a.changeYtd as number), 0) : null,
    },
    profile: { household: householdProfile, byAccount: profiles.filter((p) => p.accountNumber).length },
    exceptions,
    gaps,
  };
}
