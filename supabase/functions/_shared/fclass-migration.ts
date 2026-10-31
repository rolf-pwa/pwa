// fclass-migration.ts: which households are close to the end of their chargeback period, what moving now would cost, and what the
// move to F-class would pay each month. Pure; no I/O. The migration plan sheet is read elsewhere (fclass-migration-service.ts) and
// handed in as CSV text.
//
// Chargeback is worked out on what is still invested, not on withdrawals already made (see accountLine).
// Chargeback (the iA MGA schedule effective 2026-10-26, "Charges when a deposit is surrendered (agent's charge)"): the charge is the
// sales commission paid on the deposit times a percentage that steps down with the months the deposit has been in force, to nothing at
// the end of the chargeback period (CB2: 24 months, CB3: 36, CB5: 60). F-class: fees are paid monthly on the daily balance at the
// negotiated rate, and the advisor receives 80% of that rate.

import type { DataGap, Finding } from "./opportunity-rules.ts";

export type CbLoad = "CB2" | "CB3" | "CB5";

/**
 * The sales commission rate for each chargeback option on the standard funds in the schedule. The sheet carries no fund, so this is an
 * assumption: FORLIFE Guaranteed Income & Growth pays less (1.74% / 2.0% / 3%) and the Money Market fund pays none, and a deposit made
 * under an earlier schedule carried that schedule's rate.
 */
export const CB_SALES_COMMISSION: Record<CbLoad, number> = { CB2: 0.0232, CB3: 0.025, CB5: 0.04 };

export interface FClassConfig {
  /** How soon a chargeback maturity counts as close, in months. */
  windowMonths: number;
  /** The negotiated annual fee rate with the client. */
  feeRate: number;
  /** The share of that fee the schedule pays the advisor. */
  advisorShare: number;
  /** The override paid on the advisory fees, as a share of the fee it is based on. Omitted: none. */
  overrideRate?: number;
  /** What the override is a share of: the fee the client pays ("client_fee") or the part of it paid to the advisor ("advisor_fee"). */
  overrideBasis?: "client_fee" | "advisor_fee";
}
// Overrides are 5% of the advisory fees paid (Rolf, 2026-10-31); read as 5% of the fee the client pays, so 0.05% of market value a year at a 1% fee.
export const DEFAULT_FCLASS: FClassConfig = { windowMonths: 12, feeRate: 0.01, advisorShare: 0.8, overrideRate: 0.05, overrideBasis: "client_fee" };

/** CB2's published percentages for months 13 to 24 in force (they step by 100/13, so they are listed as printed). */
const CB2_STEPS = [92.3, 84.6, 76.9, 69.2, 61.5, 53.8, 46.1, 38.4, 30.7, 23, 15.3, 7.6];
const CB_MONTHS: Record<CbLoad, number> = { CB2: 24, CB3: 36, CB5: 60 };

/** The share of the sales commission charged back, by the month the deposit is in (1 = the first month). Zero once the period is over. */
export function chargebackPct(load: CbLoad, monthInForce: number): number {
  const n = Math.max(1, Math.floor(monthInForce));
  if (n <= 12) return 100;
  if (n > CB_MONTHS[load]) return 0;
  if (load === "CB2") return CB2_STEPS[n - 13];
  if (load === "CB3") return 100 - 4 * (n - 12);
  return 100 - 2 * (n - 12);
}

const parseYmd = (s: string) => { const [y, m, d] = s.split("-").map(Number); return { y, m, d }; };

/** Which month of the deposit's life a date falls in: 1 for the first twelve months, 13 once twelve full months have passed, and so on. */
export function monthInForce(investedYmd: string, asOfYmd: string): number {
  const a = parseYmd(investedYmd), b = parseYmd(asOfYmd);
  const completed = (b.y - a.y) * 12 + (b.m - a.m) - (b.d < a.d ? 1 : 0);
  return Math.max(0, completed) + 1;
}

export function addMonthsYmd(ymd: string, months: number): string {
  const { y, m, d } = parseYmd(ymd);
  const t = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), Math.min(d, last))).toISOString().slice(0, 10);
}

/** Monthly F-class fee paid to the advisor: market value times the fee rate times the advisor's share, over twelve months. */
export function monthlyFClassFee(marketValue: number, cfg: FClassConfig = DEFAULT_FCLASS): number {
  return round2((marketValue * cfg.feeRate * cfg.advisorShare) / 12);
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Monthly override paid on the account's advisory fee: market value times the fee rate, times the basis share, times the override rate, over twelve months. */
export function monthlyOverride(marketValue: number, cfg: FClassConfig = DEFAULT_FCLASS): number {
  const share = cfg.overrideBasis === "advisor_fee" ? cfg.advisorShare : 1;
  return round2((marketValue * cfg.feeRate * share * (cfg.overrideRate ?? 0)) / 12);
}

/** Months of F-class fees it takes to earn back a chargeback, to one decimal. Null when there is no fee to count. */
export function breakEvenMonths(chargeback: number, monthlyFee: number): number | null {
  return monthlyFee > 0 ? Math.round((chargeback / monthlyFee) * 10) / 10 : null;
}

const monthsText = (m: number) => `${m} ${m === 1 ? "month" : "months"}`;

// --- the sheet -------------------------------------------------------------------------------------------------------------------

/** RFC 4180 CSV: quoted fields with commas, doubled quotes and line breaks. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", inQuotes = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') { if (src[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && src[i + 1] === "\n") i++; row.push(field); rows.push(row); row = []; field = ""; }
    else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/** "$27,791.95", "CA$1,200.00", "(50.00)" -> a number; blank or unreadable -> null. */
export function parseMoney(s: string | undefined): number | null {
  if (!s || !s.trim()) return null;
  const neg = /^\(.*\)$/.test(s.trim()) || /-/.test(s);
  const n = Number(s.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && /\d/.test(s) ? (neg ? -n : n) : null;
}

/** "2023-11-30" or "11/30/2023" -> "2023-11-30"; blank or unreadable -> null. */
export function parseDate(s: string | undefined): string | null {
  const t = (s ?? "").trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  return m ? `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}` : null;
}

export interface MigrationRow {
  account: string;
  accountType: string;
  owner: string;
  investedOn: string | null;
  original: number | null;
  loadType: string;
  maturesOn: string | null;
  marketValue: number | null;
  /** iA's "Net Transactions (Deposits - Withdrawals)" since contract issue: negative when more has been withdrawn than deposited. Optional column. */
  netTransactions: number | null;
}

const COLUMNS = { account: "Account Number", accountType: "Account Type", investedOn: "Investment Date", original: "Original Investment", loadType: "Load Type", maturesOn: "CB Maturity Date", marketValue: "Managed Investments", netTransactions: "Net Transactions", first: "First Name", last: "Last Name" } as const;

/** Reads the sheet by its header names, not by column letter, so inserting a column does not shift the meaning. */
export function parseSheet(csv: string): { rows: MigrationRow[]; missingColumns: string[] } {
  const table = parseCsv(csv);
  const header = (table[0] ?? []).map((h) => h.trim().toLowerCase());
  const at = (name: string) => header.indexOf(name.toLowerCase());
  const idx = Object.fromEntries(Object.entries(COLUMNS).map(([k, name]) => [k, at(name)])) as Record<keyof typeof COLUMNS, number>;
  const required: (keyof typeof COLUMNS)[] = ["account", "investedOn", "original", "loadType", "maturesOn", "marketValue"];
  const missingColumns = required.filter((k) => idx[k] < 0).map((k) => COLUMNS[k]);
  if (missingColumns.length) return { rows: [], missingColumns };
  const cell = (r: string[], k: keyof typeof COLUMNS) => (idx[k] >= 0 ? (r[idx[k]] ?? "").trim() : "");
  const rows: MigrationRow[] = [];
  for (const r of table.slice(1)) {
    const account = cell(r, "account");
    if (!account) continue; // the totals row, blank lines
    rows.push({
      account, accountType: cell(r, "accountType"), owner: [cell(r, "first"), cell(r, "last")].filter(Boolean).join(" "),
      investedOn: parseDate(cell(r, "investedOn")), original: parseMoney(cell(r, "original")), loadType: cell(r, "loadType").toUpperCase().replace(/\s+/g, ""),
      maturesOn: parseDate(cell(r, "maturesOn")), marketValue: parseMoney(cell(r, "marketValue")), netTransactions: parseMoney(cell(r, "netTransactions")),
    });
  }
  return { rows, missingColumns: [] };
}

// --- the rule --------------------------------------------------------------------------------------------------------------------

export const digits = (s: string) => s.replace(/\D/g, "");

export interface AccountLine {
  account: string;
  accountType: string;
  load: CbLoad;
  investedOn: string;
  maturesOn: string;
  monthInForce: number;
  pctCharged: number;
  original: number | null;
  /** What a chargeback can still apply to: the original investment less what has been withdrawn (see accountLine). Null with no original. */
  chargeableBase: number | null;
  /** The part of the original investment withdrawn already (its chargeback was charged to the advisor then). */
  withdrawn: number;
  /** "net": from iA's net transactions in the sheet. "estimated": from the market value, because the sheet has no net transactions for the account. */
  basis: "net" | "estimated";
  /** Net Transactions is positive although the account is below its original investment: iA shows withdrawals as negative, so the figure was probably entered without its minus sign. It is not used. */
  signSuspect: boolean;
  /** The Net Transactions figure as entered, for the finding to quote. */
  netTransactions: number | null;
  /** Null when the original investment is not in the sheet. */
  chargeback: number | null;
  marketValue: number;
  monthlyFee: number;
  /** The override paid on this account's advisory fee. */
  monthlyOverride: number;
  /** Fee plus override: the monthly compensation the move would bring. */
  monthlyComp: number;
  /** Months of this account's monthly compensation needed to cover its chargeback; null when the chargeback is unknown. */
  breakEven: number | null;
}

export type ChargebackRow = MigrationRow & { load: CbLoad; investedOn: string; maturesOn: string; marketValue: number };

/** Every account under a chargeback load with its dates and something invested; F Class, cash and anything with no chargeback are left out. */
export function chargebackRows(rows: MigrationRow[]): { all: ChargebackRow[]; undated: number } {
  const all: ChargebackRow[] = [];
  let undated = 0;
  for (const r of rows) {
    if (!(r.loadType in CB_SALES_COMMISSION)) continue; // F Class, HISA, anything that carries no chargeback
    if (!r.investedOn || !r.maturesOn) { undated += 1; continue; }
    if (!r.marketValue || r.marketValue <= 0) continue;
    all.push({ ...r, load: r.loadType as CbLoad, investedOn: r.investedOn, maturesOn: r.maturesOn, marketValue: r.marketValue });
  }
  return { all, undated };
}

/** The chargeback accounts with a maturity inside the window (or already past it): the ones that bring their household into the list. */
export function dueRows(rows: MigrationRow[], asOf: string, cfg: FClassConfig = DEFAULT_FCLASS): { due: ChargebackRow[]; undated: number } {
  const limit = addMonthsYmd(asOf, cfg.windowMonths);
  const { all, undated } = chargebackRows(rows);
  return { due: all.filter((r) => r.maturesOn <= limit), undated };
}

export function accountLine(r: ChargebackRow, asOf: string, cfg: FClassConfig = DEFAULT_FCLASS): AccountLine {
  const month = monthInForce(r.investedOn, asOf);
  const pct = chargebackPct(r.load, month);
  const fee = monthlyFClassFee(r.marketValue, cfg), override = monthlyOverride(r.marketValue, cfg), comp = round2(fee + override);
  // What a chargeback can still apply to is the original investment less what has been withdrawn since (the chargeback on a withdrawal was
  // already charged to the advisor when it was made: Rolf, 2026-10-31). iA's net transactions give that exactly. Without them it is
  // estimated from the market value: the shortfall below the original is taken to be withdrawals. That ignores growth, so it overstates
  // the base, and it cannot see withdrawals hidden by growth when the market value is at or above the original.
  let base: number | null = null;
  const net = r.netTransactions ?? null;
  // A positive figure on an account that is below its original investment is almost certainly withdrawals entered without the minus sign.
  // Reading it as net deposits would charge back on the whole original with full confidence, so it is not used: the estimate stands and the
  // entry is flagged for checking.
  const signSuspect = net !== null && net > 0 && r.original !== null && r.marketValue < r.original;
  const useNet = net !== null && !signSuspect;
  const basis: AccountLine["basis"] = useNet ? "net" : "estimated";
  if (r.original !== null) base = useNet ? Math.min(r.original, Math.max(0, r.original + (net ?? 0))) : Math.min(r.original, r.marketValue);
  return {
    account: r.account, accountType: r.accountType, load: r.load, investedOn: r.investedOn, maturesOn: r.maturesOn, monthInForce: month, pctCharged: pct,
    original: r.original, chargeableBase: base, withdrawn: r.original === null || base === null ? 0 : round2(r.original - base), basis, signSuspect, netTransactions: net,
    chargeback: base === null ? null : round2(base * CB_SALES_COMMISSION[r.load] * (pct / 100)),
    marketValue: r.marketValue, monthlyFee: fee, monthlyOverride: override, monthlyComp: comp,
    breakEven: base === null ? null : breakEvenMonths(round2(base * CB_SALES_COMMISSION[r.load] * (pct / 100)), comp),
  };
}

const money = (n: number) => `$${Math.round(n).toLocaleString("en-CA")}`;
const money2 = (n: number) => `$${n.toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const last4 = (a: string) => digits(a).slice(-4) || a.slice(-4);

export interface MigrationReport {
  findings: Finding[];
  gaps: DataGap[];
  /** Chargeback accounts that matched no household in the CRM, by their last four digits (any of them might belong to a household on the list). */
  unmatched: string[];
  /** Accounts maturing inside the window: the ones that bring a household onto the list. */
  dueCount: number;
  /** Accounts in the households on the list (all their chargeback accounts, not only those maturing soon). */
  includedCount: number;
  undated: number;
}

/**
 * One finding per household that has at least one chargeback account maturing inside the window. The finding covers all of that household's
 * chargeback accounts: the chargeback if every one moved today, and the monthly F-class fee on all of them. Accounts inside the window are tagged.
 */
export function buildMigrationFindings(rows: MigrationRow[], accountToHousehold: Map<string, string>, asOf: string, cfg: FClassConfig = DEFAULT_FCLASS): MigrationReport {
  const { all, undated } = chargebackRows(rows);
  const limit = addMonthsYmd(asOf, cfg.windowMonths);
  const byHousehold = new Map<string, { line: AccountLine; inWindow: boolean }[]>();
  const unmatched: string[] = [];
  for (const r of all) {
    const hh = accountToHousehold.get(digits(r.account));
    if (!hh) { unmatched.push(last4(r.account)); continue; }
    byHousehold.set(hh, [...(byHousehold.get(hh) ?? []), { line: accountLine(r, asOf, cfg), inWindow: r.maturesOn <= limit }]);
  }
  const dueCount = all.filter((r) => r.maturesOn <= limit).length;
  let includedCount = 0;

  const findings: Finding[] = [], gaps: DataGap[] = [];
  for (const [householdId, items] of byHousehold) {
    if (!items.some((i) => i.inWindow)) continue; // no account maturing inside the window: the household is not on the list
    includedCount += items.length;
    const inWindow = new Set(items.filter((i) => i.inWindow).map((i) => i.line.account));
    const lines = items.map((i) => i.line).sort((a, b) => a.maturesOn.localeCompare(b.maturesOn));
    const known = lines.filter((l) => l.chargeback !== null);
    const missing = lines.length - known.length;
    // An estimated base with money already gone is a guess; the sheet needs iA's net transactions for that account.
    const suspects = lines.filter((l) => l.signSuspect);
    const guessed = lines.filter((l) => l.basis === "estimated" && l.withdrawn > 0 && !l.signSuspect);
    const totalCb = round2(known.reduce((t, l) => t + (l.chargeback ?? 0), 0));
    const totalFee = round2(lines.reduce((t, l) => t + l.monthlyFee, 0));
    const totalOverride = round2(lines.reduce((t, l) => t + l.monthlyOverride, 0));
    const totalComp = round2(totalFee + totalOverride);
    const knownComp = round2(known.reduce((t, l) => t + l.monthlyComp, 0));
    const be = known.length ? breakEvenMonths(totalCb, knownComp) : null;
    const totalValue = lines.reduce((t, l) => t + l.marketValue, 0);
    const first = lines[0].maturesOn, final = lines[lines.length - 1].maturesOn;
    const cbText = missing === lines.length ? "chargeback not yet known" : `chargeback ${missing ? "at least " : ""}${money2(totalCb)} if all moved today`;
    findings.push({
      householdId, type: "fclass_migration", key: "fclass-migration", dueOn: first,
      title: `${lines.length} account${lines.length === 1 ? "" : "s"} under chargeback, ${inWindow.size} maturing within ${cfg.windowMonths} months: ${cbText}, ${money2(totalComp)} a month in fees${totalOverride > 0 ? " and overrides" : ""}`,
      evidence: [
        { label: "Total chargeback if every account moved today", value: missing === lines.length ? "Not known: original investment missing" : `${missing ? "At least " : ""}${money2(totalCb)}` },
        { label: `Monthly F-class fee (your ${Math.round(cfg.advisorShare * 100)}% of ${cfg.feeRate * 100}%)`, value: money2(totalFee) },
        { label: `Monthly override on the fees (${Math.round((cfg.overrideRate ?? 0) * 1000) / 10}% of the ${cfg.overrideBasis === "advisor_fee" ? "fee paid to you" : "advisory fee"})`, value: money2(totalOverride) },
        { label: "Total monthly compensation (fee plus override)", value: money2(totalComp) },
        {
          label: "Months of total compensation to cover the chargeback",
          value: known.length === 0 ? "Not known: original investment missing" : be === null ? "No fee to count" : totalCb === 0 ? "No chargeback to cover" : `${missing ? "At least " : ""}${monthsText(be)}`,
        },
        { label: "Market value in these accounts", value: money(totalValue) },
        ...lines.map((l) => ({
          label: `${l.accountType || "Account"} ...${last4(l.account)} (${l.load}, ${l.maturesOn <= asOf ? "matured" : "matures"} ${l.maturesOn}${inWindow.has(l.account) ? `, within ${cfg.windowMonths} months` : ""}, month ${l.monthInForce}, ${l.pctCharged}% charged)`,
          value: `${l.chargeback === null ? "chargeback unknown" : `chargeback ${money2(l.chargeback)}${l.withdrawn > 0 ? ` on ${money(l.chargeableBase ?? 0)} (${l.basis === "net" ? `${money(l.withdrawn)} of the ${money(l.original ?? 0)} invested already withdrawn` : `estimated: ${money(l.withdrawn)} of the ${money(l.original ?? 0)} invested assumed withdrawn; ${l.signSuspect ? `Net Transactions of +${money(l.netTransactions ?? 0)} was not used: it is positive but the account is below its original, and iA shows withdrawals as negative` : "add Net Transactions to the sheet for the exact figure"}`})` : ""}`}; fee ${money2(l.monthlyFee)}/month + override ${money2(l.monthlyOverride)}/month${l.breakEven === null || !l.chargeback ? "" : `; covered in ${monthsText(l.breakEven)}`}`,
        })),
      ],
      confidence: missing || guessed.length || suspects.length ? "medium" : "high",
      nextStep: final <= asOf
        ? "The chargeback period is over on every one of these accounts: moving to F-class costs nothing in chargeback."
        : `The chargeback falls away account by account (the first on ${first}, the last on ${final}). Moving the household together costs the total above; weigh each account's chargeback against its F-class fee to choose when to move each one.`,
      estValue: null,
    });
    if (suspects.length) gaps.push({ householdId, field: "Net transactions (migration sheet)", why: `${suspects.map((l) => `...${last4(l.account)} (+${money(l.netTransactions ?? 0)})`).join(", ")}: Net Transactions is positive but the account is below its original investment. iA shows withdrawals as negative numbers (for example -18,584.17), so the figure was not used. Check the sign.`, blocks: ["fclass_migration"] });
    if (guessed.length) gaps.push({ householdId, field: "Net transactions (migration sheet)", why: `${guessed.length} account${guessed.length === 1 ? "" : "s"} (${guessed.map((l) => "..." + last4(l.account)).join(", ")}) ${guessed.length === 1 ? "is" : "are"} below ${guessed.length === 1 ? "its" : "their"} original investment; iA's net transactions since contract issue would replace the estimate of what was withdrawn.`, blocks: ["fclass_migration"] });
    if (missing) gaps.push({ householdId, field: "Original investment (migration sheet)", why: `${missing} account${missing === 1 ? "" : "s"} under chargeback ${missing === 1 ? "has" : "have"} no original investment in the sheet, so the chargeback is ${missing === lines.length ? "unknown" : "understated"}.`, blocks: ["fclass_migration"] });
  }
  return { findings, gaps, unmatched, dueCount, includedCount, undated };
}
