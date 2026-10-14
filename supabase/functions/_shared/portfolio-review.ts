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
  /** The "Your guarantees" section of a segregated fund statement, when the account has one. */
  guarantee?: Guarantee | null;
  /** What iA's own statement says the account's mix and profile are. */
  statementAllocation?: { incomePct: number | null; equityPct: number | null; profile: string | null } | null;
  /** Date of birth of the account's owner (the annuitant), for the age-85 reset cut-off. */
  ownerDob?: string | null;
  /** When staff last reset the death benefit guarantee on this account. */
  lastResetDate?: string | null;
}

export interface Guarantee { series: string | null; maturityDate: string | null; guaranteedAtMaturity: number | null; guaranteedAtDeath: number | null; lastQuarterFee: number | null; valueOfFunds: number | null }

/** Death benefit resets end at this age. */
export const RESET_END_AGE = 85;
export type ResetStatus = "reset" | "no_room" | "no_reset_series" | "too_old" | "needs_dob" | "no_guarantee_data";
export interface ResetRow {
  accountId: string; name: string; number: string | null; owner: string | null; series: string | null; age: number | null; turns85On: string | null; lastChance: boolean;
  fundValue: number | null; deathGuarantee: number | null; /** What a reset would add to the death guarantee. */ room: number | null; status: ResetStatus; lastResetDate: string | null;
}
export interface ResetSummary { rows: ResetRow[]; toReset: number; totalRoom: number }

/** Series 75/100 can be reset; Series 75/75 cannot. The pricing label (Prestige 300 or 500, Classic) is irrelevant. */
export const isResetSeries = (series: string | null | undefined) => /75\s*\/\s*100/.test(String(series ?? ""));

export function ageOn(dob: string, on: string): number {
  const [by, bm, bd] = dob.split("-").map(Number);
  const [y, m, d] = on.split("-").map(Number);
  return y - by - (m < bm || (m === bm && d < bd) ? 1 : 0);
}

/**
 * The death benefit reset check. The guaranteed value at death is the last reset amount, so what a reset adds is the fund value less that
 * guarantee. A reset is one click on iA's advisor site, costs nothing and changes no fee, so every eligible account with room is listed.
 */
export function resetCheck(accounts: PackAccount[], today: string): ResetSummary {
  const rows: ResetRow[] = accounts.filter((a) => a.guarantee || isResetSeries(a.guarantee?.series)).map((a) => {
    const g = a.guarantee!;
    const fundValue = g.valueOfFunds ?? a.value;
    const deathGuarantee = g.guaranteedAtDeath;
    const age = a.ownerDob ? ageOn(a.ownerDob, today) : null;
    const turn85 = a.ownerDob ? `${Number(a.ownerDob.slice(0, 4)) + RESET_END_AGE}${a.ownerDob.slice(4)}` : null;
    const room = fundValue !== null && deathGuarantee !== null ? Math.round((fundValue - deathGuarantee) * 100) / 100 : null;
    let status: ResetStatus;
    if (!isResetSeries(g.series)) status = "no_reset_series";
    else if (deathGuarantee === null || fundValue === null) status = "no_guarantee_data";
    else if (age === null) status = "needs_dob";
    else if (age >= RESET_END_AGE) status = "too_old";
    else status = room !== null && room > 0 ? "reset" : "no_room";
    const lastChance = status === "reset" && turn85 !== null && turn85 <= `${today.slice(0, 4)}-12-31`;
    return { accountId: a.id, name: a.name, number: a.number, owner: a.owner, series: g.series, age, turns85On: turn85, lastChance, fundValue, deathGuarantee, room, status, lastResetDate: a.lastResetDate ?? null };
  });
  const due = rows.filter((r) => r.status === "reset");
  return { rows, toReset: due.length, totalRoom: Math.round(due.reduce((s, r) => s + (r.room ?? 0), 0) * 100) / 100 };
}

export interface InvestorProfile { accountNumber: string | null; label: string | null; incomePct: number | null; equityPct: number | null; bandPct: number; asOf?: string | null; source?: string | null }

/** Statements print whole percentages, so a mix within half a point of the target is on target. */
export const HARD_LINE_TOLERANCE = 0.5;
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
  if (base <= 0) return { status: "no_data", targetIncomePct: profile?.incomePct ?? null, actualIncomePct: null, bandPct: profile?.bandPct ?? 0, moveToIncome: null };
  const actual = (t.income / base) * 100;
  if (!profile || profile.incomePct === null) return { status: "no_target", targetIncomePct: null, actualIncomePct: round1(actual), bandPct: profile?.bandPct ?? 0, moveToIncome: null };
  const diff = actual - profile.incomePct;
  // iA holds an account to its profile on a hard line; statements print whole points, so anything that rounds to the target is on it.
  const status: DriftStatus = Math.abs(diff) <= Math.max(profile.bandPct, HARD_LINE_TOLERANCE) ? "within" : diff > 0 ? "too_much_income" : "too_little_income";
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
  resets: ResetSummary;
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
      drift: t ? driftFor(t, prof) : { status: "no_data", targetIncomePct: prof?.incomePct ?? null, actualIncomePct: null, bandPct: prof?.bandPct ?? 0, moveToIncome: null },
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
    hhDrift = driftFor(hhTotals, tgt === null ? null : { incomePct: round1(tgt), bandPct: 0 });
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
  const resets = resetCheck(accounts, today);
  for (const r of resets.rows) if (r.status === "needs_dob") gaps.push(`Add a date of birth for ${r.owner ?? "the owner"} to check the age-85 reset limit on ${r.name || r.number}.`);
  for (const r of resets.rows) if (r.lastChance) exceptions.push({ severity: "attention", text: `${r.name || r.number}: ${r.owner ?? "the owner"} turns 85 on ${r.turns85On}. This year's reset is the last one.` });

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
    resets: resetCheck(accounts, today),
  };
}
