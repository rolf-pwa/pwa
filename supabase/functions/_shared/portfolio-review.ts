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
 * The death benefit reset check. The guaranteed value at death is the last reset amount, so what a reset adds is the latest fund value less
 * that guarantee (an estimate until the reset is done: the guarantee is set to the value on the day). A reset is one click on iA's advisor site, costs nothing and changes no fee, so every eligible account with room is listed.
 */
export function resetCheck(accounts: PackAccount[], today: string): ResetSummary {
  const rows: ResetRow[] = accounts.filter((a) => a.guarantee || isResetSeries(a.guarantee?.series)).map((a) => {
    const g = a.guarantee!;
    // A reset locks in the value on the day it is done, so use the latest value we have (the monthly import), not the older statement's.
    const fundValue = a.value ?? g.valueOfFunds;
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

export interface InvestorProfile { accountNumber: string | null; label: string | null; incomePct: number | null; equityPct: number | null; bandPct: number; asOf?: string | null; source?: string | null; profileKey?: string | null }

/** One of iA's published model portfolios (Prudent to Aggressive). The income range is the line iA itself uses to label an account's profile. */
export interface ModelPortfolio { asOf: string; key: string; label: string; incomeMin: number; incomeMax: number; equityMin: number; equityMax: number; incomeTarget: number; funds: { name: string; weight: number }[] }

/** A profile with the model it points at applied: the model's range and point target replace anything typed in. A custom profile has no range. */
export type ResolvedProfile = InvestorProfile & { rangeMin?: number | null; rangeMax?: number | null; model?: ModelPortfolio | null };
export function resolveProfile(p: InvestorProfile | null, models: ModelPortfolio[]): ResolvedProfile | null {
  if (!p) return null;
  const m = p.profileKey ? models.find((x) => x.key === p.profileKey) ?? null : null;
  if (!m) return { ...p, model: null };
  return { ...p, incomePct: m.incomeTarget, equityPct: 100 - m.incomeTarget, rangeMin: m.incomeMin, rangeMax: m.incomeMax, model: m, label: m.label };
}

/** Statements print whole percentages, so a mix within half a point of the target is on target. */
export const HARD_LINE_TOLERANCE = 0.5;
/** A fund's name without the statement's series and sales-charge prefix ("3603H-NSC-" or "3233B-DSC-"), so it can be matched to a model's fund. */
export function normalizeFundName(raw: string | null | undefined): string {
  return String(raw ?? "").replace(/^\s*\d+[A-Za-z]?-[A-Za-z]{3}-/, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}
const cleanFundName = (raw: string) => raw.replace(/^\s*\d+[A-Za-z]?-[A-Za-z]{3}-/, "").trim();

export interface FundDeviationRow { name: string; modelPct: number | null; actualPct: number; actualValue: number; /** Actual less model, in points. Positive: holds more than the model. */ diffPts: number; inModel: boolean }
export interface ModelComparison {
  modelKey: string; modelLabel: string; modelAsOf: string; rows: FundDeviationRow[];
  /** The share held in funds the model does not contain. */
  offModelPct: number;
  /** The share that would have to move to match the model exactly (half the sum of the differences). */
  activeSharePct: number; totalValue: number; moveValue: number;
}

/** Compares an account's (or household's) funds, fund by fund, with a model's funds and weights. Weights are of the funds listed. */
export function compareToModel(funds: FundRow[], model: ModelPortfolio): ModelComparison | null {
  const total = funds.reduce((s, f) => s + (Number.isFinite(f.value) ? f.value : 0), 0);
  if (total <= 0) return null;
  const held = new Map<string, { name: string; value: number }>();
  for (const f of funds) {
    const k = normalizeFundName(f.name);
    const cur = held.get(k) ?? { name: cleanFundName(f.name), value: 0 };
    cur.value += Number.isFinite(f.value) ? f.value : 0;
    held.set(k, cur);
  }
  const rows: FundDeviationRow[] = [];
  const seen = new Set<string>();
  for (const mf of model.funds) {
    const k = normalizeFundName(mf.name);
    seen.add(k);
    const h = held.get(k);
    const actualPct = h ? (h.value / total) * 100 : 0;
    rows.push({ name: mf.name, modelPct: mf.weight, actualPct: round1(actualPct), actualValue: Math.round(h?.value ?? 0), diffPts: round1(actualPct - mf.weight), inModel: true });
  }
  for (const [k, h] of held) {
    if (seen.has(k)) continue;
    const actualPct = (h.value / total) * 100;
    rows.push({ name: h.name, modelPct: null, actualPct: round1(actualPct), actualValue: Math.round(h.value), diffPts: round1(actualPct), inModel: false });
  }
  rows.sort((a, b) => Number(b.inModel) - Number(a.inModel) || b.actualPct - a.actualPct);
  const offModelPct = round1(rows.filter((r) => !r.inModel).reduce((s, r) => s + r.actualPct, 0));
  const activeSharePct = round1(rows.reduce((s, r) => s + Math.abs(r.diffPts), 0) / 2);
  return { modelKey: model.key, modelLabel: model.label, modelAsOf: model.asOf, rows, offModelPct, activeSharePct, totalValue: Math.round(total), moveValue: Math.round((activeSharePct / 100) * total) };
}

export type DriftStatus = "within" | "too_much_income" | "too_little_income" | "no_target" | "no_data";
export interface Drift { status: DriftStatus; targetIncomePct: number | null; actualIncomePct: number | null; bandPct: number; /** iA's income range for the profile, when the profile is one of its models. */ rangeMin?: number | null; rangeMax?: number | null; profileLabel?: string | null; /** Dollars to move out of income (positive) or into income (negative) to reach target. */ moveToIncome: number | null }

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
export function driftFor(t: ClassTotals, profile: (Pick<InvestorProfile, "incomePct" | "bandPct"> & { rangeMin?: number | null; rangeMax?: number | null; label?: string | null }) | null): Drift {
  const base = t.income + equityOf(t);
  if (base <= 0) return { status: "no_data", targetIncomePct: profile?.incomePct ?? null, actualIncomePct: null, bandPct: profile?.bandPct ?? 0, moveToIncome: null };
  const actual = (t.income / base) * 100;
  if (!profile || profile.incomePct === null) return { status: "no_target", targetIncomePct: null, actualIncomePct: round1(actual), bandPct: profile?.bandPct ?? 0, moveToIncome: null };
  const diff = actual - profile.incomePct;
  const tol = Math.max(profile.bandPct, HARD_LINE_TOLERANCE);
  // A model profile is held to iA's published income range (statements print whole points, so a half point either side still counts as in).
  // A custom profile is held to its own target, on iA's hard line.
  const hasRange = profile.rangeMin != null && profile.rangeMax != null;
  let status: DriftStatus;
  if (hasRange) status = actual < (profile.rangeMin as number) - tol ? "too_little_income" : actual > (profile.rangeMax as number) + tol ? "too_much_income" : "within";
  else status = Math.abs(diff) <= tol ? "within" : diff > 0 ? "too_much_income" : "too_little_income";
  return { status, rangeMin: profile.rangeMin ?? null, rangeMax: profile.rangeMax ?? null, profileLabel: profile.label ?? null, targetIncomePct: profile.incomePct, actualIncomePct: round1(actual), bandPct: profile.bandPct, moveToIncome: Math.round(((profile.incomePct - actual) / 100) * base) };
}
const round1 = (n: number) => Math.round(n * 10) / 10;

export interface PackException { severity: "attention" | "note"; text: string }
export interface PackAccountOut extends PackAccount {
  changeSincePrior: number | null; changeSincePriorPct: number | null; changeYtd: number | null;
  classTotals: ClassTotals | null; incomePct: number | null; drift: Drift; statementAgeDays: number | null; modelComparison: ModelComparison | null;
}
export interface Pack {
  asOf: string | null;
  totalValue: number;
  accounts: PackAccountOut[];
  household: { modelComparison: ModelComparison | null; classTotals: ClassTotals; coveredValue: number; coveragePct: number | null; drift: Drift; valueWeightedYtd: number | null; changeSincePrior: number | null; changeYtd: number | null };
  profile: { household: InvestorProfile | null; byAccount: number };
  /** The iA model set in use (null when no profile points at one). */
  modelAsOf: string | null;
  exceptions: PackException[];
  gaps: string[];
  resets: ResetSummary;
  /** The household's managed value at each month-end the import has recorded, oldest first. */
  history: { date: string; value: number }[];
}

export const STATEMENT_STALE_DAYS = 120;
export const BAD_YTD_PCT = -10;
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
const money = (n: number) => n.toLocaleString("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 });
const norm = (s: string | null | undefined) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

export function buildPortfolioPack(input: { accounts: PackAccount[]; profiles: InvestorProfile[]; today: string; models?: ModelPortfolio[]; history?: { date: string; value: number }[] }): Pack {
  const { today } = input;
  const models = input.models ?? [];
  const profiles = input.profiles.map((p) => resolveProfile(p, models) as ResolvedProfile);
  // A zero balance has nothing to review: leave it out of the totals, the allocation, the gaps and the reset list.
  const accounts = input.accounts.filter((a) => !(a.value !== null && a.value <= 0));
  const householdProfile = profiles.find((p) => !p.accountNumber) ?? null;
  const profileFor = (a: PackAccount): ResolvedProfile | null => profiles.find((p) => p.accountNumber && norm(p.accountNumber) === norm(a.number)) ?? householdProfile;

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
      modelComparison: prof?.model && a.statement?.funds.length ? compareToModel(a.statement.funds, prof.model) : null,
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
    // One model across every profiled account: hold the household to that model's range. Mixed profiles: the weighted point target.
    const keys = new Set(withTarget.map((a) => profileFor(a)?.model?.key ?? "custom"));
    const only = keys.size === 1 && !keys.has("custom") ? profileFor(withTarget[0]) : null;
    hhDrift = driftFor(hhTotals, only ? only : tgt === null ? null : { incomePct: round1(tgt), bandPct: 0 });
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
    const against = a.drift.rangeMin != null ? `outside the ${a.drift.profileLabel ?? "profile"} range (${a.drift.rangeMin}-${a.drift.rangeMax}% income); ${money(Math.abs(a.drift.moveToIncome ?? 0))} to move ${a.drift.status === "too_much_income" ? "into equity" : "into income"} to reach the ${a.drift.targetIncomePct}% model mix` : `against a ${a.drift.targetIncomePct}% target (${money(Math.abs(a.drift.moveToIncome ?? 0))} to move ${a.drift.status === "too_much_income" ? "into equity" : "into income"})`;
    if (a.drift.status === "too_much_income" || a.drift.status === "too_little_income") exceptions.push({ severity: "attention", text: `${label} holds ${a.drift.actualIncomePct}% income, ${against}.` });
    if (a.modelComparison && a.modelComparison.offModelPct > 0) {
      const names = a.modelComparison.rows.filter((r) => !r.inModel).map((r) => r.name);
      exceptions.push({ severity: "attention", text: `${label} holds ${a.modelComparison.offModelPct}% in funds that are not in the ${a.modelComparison.modelLabel} model (${names.slice(0, 3).join(", ")}${names.length > 3 ? `, and ${names.length - 3} more` : ""}). About ${money(a.modelComparison.moveValue)} would move to match the model.` });
    }
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
      modelComparison: householdModelComparison(out),
      classTotals: hhTotals, coveredValue, coveragePct: totalValue > 0 ? round1((coveredValue / totalValue) * 100) : null, drift: hhDrift, valueWeightedYtd,
      changeSincePrior: priorKnown.length ? priorKnown.reduce((s, a) => s + (a.changeSincePrior as number), 0) : null,
      changeYtd: ytdKnown.length ? ytdKnown.reduce((s, a) => s + (a.changeYtd as number), 0) : null,
    },
    profile: { household: householdProfile, byAccount: profiles.filter((p) => p.accountNumber).length },
    modelAsOf: profiles.map((p) => p.model?.asOf).filter(Boolean).sort().pop() ?? null,
    exceptions,
    gaps,
    resets: resetCheck(accounts, today),
    history: input.history ?? [],
  };
}

/** The household's funds against one model, when every profiled account points at the same model; otherwise null. */
function householdModelComparison(accounts: PackAccountOut[]): ModelComparison | null {
  const withModel = accounts.filter((a) => a.modelComparison && a.statement);
  if (!withModel.length) return null;
  const keys = new Set(withModel.map((a) => a.modelComparison!.modelKey));
  if (keys.size !== 1) return null;
  // Rebuild a model from the first comparison's rows so this needs no model lookup: model rows are those with a model weight.
  const first = withModel[0].modelComparison!;
  const model: ModelPortfolio = { asOf: first.modelAsOf, key: first.modelKey, label: first.modelLabel, incomeMin: 0, incomeMax: 0, equityMin: 0, equityMax: 0, incomeTarget: 0, funds: first.rows.filter((r) => r.inModel).map((r) => ({ name: r.name, weight: r.modelPct as number })) };
  return compareToModel(withModel.flatMap((a) => a.statement!.funds), model);
}
