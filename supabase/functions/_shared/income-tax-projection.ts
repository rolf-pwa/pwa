// This year's income tax on the family's yearly income, estimated from the maintained tax tables
// (governance-audit-tax-config.ts). Pure: the model never does this arithmetic.
//
// What is counted as taxable income, per taxpayer:
//  - withdrawals from registered accounts (RRSP / RRIF / LIRA / LIF): in full;
//  - withdrawals from non-registered accounts: split the way last year's T3 / T5 slips split the income (interest and
//    other income in full; eligible and other dividends grossed up, less the dividend tax credit; capital gains at the
//    inclusion rate; return of capital not taxed). With no slips on file, only the share that is gain (the account's
//    unrealised gain over its value, an approximation) is taxed, at the inclusion rate;
//  - withdrawals from a TFSA: not taxable;
//  - government benefits (CPP / OAS) and other outside income stated in the Charter: in full.
// Credits other than the basic personal amount (age, pension, medical), OAS recovery tax and income splitting are NOT
// modelled, and neither is tax on income-fund distributions inside non-registered accounts. The result is an estimate.

import { TAX_TABLES } from "./governance-audit-tax-config.ts";
import type { IncomeMix } from "./tax-slip-mix.ts";
import { emptyLines, sanitizeLines, taxFromLines, type TaxLines } from "./tax-lines.ts";

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export interface DrawAccount {
  /** Who owns it (a contact id or name); accounts with no owner are pooled under "Household". */
  owner: string | null;
  accountType: string;
  /** The amount drawn this year from it. */
  amount: number;
  currentValue: number;
  bookValue: number;
}

export interface TaxpayerTax {
  name: string;
  registeredDraws: number;
  nonRegisteredDraws: number;
  taxableGains: number;
  dividendsGrossedUp: number;
  dividendCredit: number;
  tfsaDraws: number;
  benefits: number;
  taxableIncome: number;
  federalTax: number;
  provincialTax: number;
  totalTax: number;
  effectiveRate: number;
  marginalRate: number;
}

export interface IncomeTaxProjection {
  province: string;
  taxYearTables: number;
  /** How the non-registered withdrawals were split: last year's tax slips, or the accounts' unrealised gain. */
  basis: "tax_slips" | "unrealised_gain" | "household_tax_page";
  mix: IncomeMix | null;
  taxpayers: TaxpayerTax[];
  totalDraws: number;
  totalBenefits: number;
  grossIncome: number;
  totalTax: number;
  afterTaxIncome: number;
  effectiveRate: number;
  notes: string[];
}

const REGISTERED = new Set(["rrsp", "rrif", "lira", "lif", "lrif", "prif", "locked-in", "registered"]);

/** Splits the year's withdrawals into income lines: registered in full; non-registered by the slip mix (or, without one, by unrealised gain); TFSA not at all. */
export function drawLines(accounts: DrawAccount[], mix: IncomeMix | null): { lines: TaxLines; registeredDraws: number; nonRegisteredDraws: number; tfsaDraws: number } {
  let registeredDraws = 0, nonRegisteredDraws = 0, tfsaDraws = 0, ordinary = 0, eligible = 0, otherDiv = 0, gains = 0;
  for (const a of accounts) {
    const type = a.accountType.trim().toLowerCase();
    if (type === "tfsa") tfsaDraws += a.amount;
    else if (REGISTERED.has(type)) registeredDraws += a.amount;
    else {
      nonRegisteredDraws += a.amount;
      if (mix) {
        ordinary += a.amount * mix.shares.interest;
        eligible += a.amount * mix.shares.eligibleDividends;
        otherDiv += a.amount * mix.shares.otherDividends;
        gains += a.amount * mix.shares.capitalGains;
      } else {
        const gainShare = a.bookValue > 0 && a.currentValue > a.bookValue ? (a.currentValue - a.bookValue) / a.currentValue : 0;
        gains += a.amount * gainShare;
      }
    }
  }
  return {
    lines: { ...emptyLines(), pension_registered: registeredDraws, interest_other: ordinary, eligible_dividends: eligible, other_dividends: otherDiv, capital_gains: gains },
    registeredDraws, nonRegisteredDraws, tfsaDraws,
  };
}

/** null when the province has no table or there is nothing taxable to project. */
export function projectIncomeTax(opts: { province: string; accounts: DrawAccount[]; benefitsTotal: number; mix?: IncomeMix | null }): IncomeTaxProjection | null {
  const prov = TAX_TABLES.provinces[opts.province];
  if (!prov) return null;
  const draws = opts.accounts.filter((a) => a.amount > 0);
  const owners = [...new Set(draws.map((a) => a.owner ?? "Household"))];
  if (owners.length === 0 && opts.benefitsTotal <= 0) return null;
  if (owners.length === 0) owners.push("Household");
  const notes: string[] = [];
  if (owners.length > 1 && opts.benefitsTotal > 0) notes.push(`Government benefits are split equally between the ${owners.length} taxpayers.`);
  const share = owners.length ? opts.benefitsTotal / owners.length : 0;

  const taxpayers: TaxpayerTax[] = owners.map((name) => {
    const d = drawLines(draws.filter((a) => (a.owner ?? "Household") === name), opts.mix ?? null);
    const { registeredDraws, nonRegisteredDraws, tfsaDraws } = d;
    const lines: TaxLines = { ...d.lines, government_benefits: share };
    const r = taxFromLines(opts.province, lines)!;
    const { dividendsGrossedUp, dividendCredit, taxableIncome, federalTax: fedTax, provincialTax: proTax, totalTax } = r;
    const gross = registeredDraws + nonRegisteredDraws + tfsaDraws + share;
    return {
      name, registeredDraws: round2(registeredDraws), nonRegisteredDraws: round2(nonRegisteredDraws), taxableGains: r.taxableGains, dividendsGrossedUp, dividendCredit,
      tfsaDraws: round2(tfsaDraws), benefits: round2(share), taxableIncome,
      federalTax: fedTax, provincialTax: proTax, totalTax,
      effectiveRate: gross > 0 ? totalTax / gross : 0, marginalRate: r.marginalRate,
    };
  });

  const totalDraws = draws.reduce((a, d) => a + d.amount, 0);
  const grossIncome = totalDraws + opts.benefitsTotal;
  const totalTax = taxpayers.reduce((a, t) => a + t.totalTax, 0);
  if (!opts.mix && draws.some((a) => !REGISTERED.has(a.accountType.trim().toLowerCase()) && a.accountType.trim().toLowerCase() !== "tfsa" && !(a.bookValue > 0)))
    notes.push("Some non-registered accounts have no book value on file, so their withdrawals are treated as return of capital (no tax).");
  return {
    province: opts.province, basis: opts.mix ? "tax_slips" : "unrealised_gain", mix: opts.mix ?? null, taxYearTables: TAX_TABLES.asOfYear, taxpayers, totalDraws: round2(totalDraws), totalBenefits: round2(opts.benefitsTotal),
    grossIncome: round2(grossIncome), totalTax: round2(totalTax), afterTaxIncome: round2(grossIncome - totalTax),
    effectiveRate: grossIncome > 0 ? totalTax / grossIncome : 0, notes,
  };
}

/** The projection as saved on the household Tax page (one entry per taxpayer), in the same shape the audit prints. null when nothing usable is saved. */
export function projectionFromSaved(rows: { name: string; province: string; lines: unknown }[], fallbackProvince: string): IncomeTaxProjection | null {
  const province = rows[0]?.province ?? fallbackProvince;
  const taxpayers: TaxpayerTax[] = [];
  let totalDraws = 0, totalBenefits = 0, gross = 0;
  for (const row of rows) {
    const l = sanitizeLines(row.lines);
    const r = taxFromLines(province, l);
    if (!r) return null;
    const cash = l.employment + l.pension_registered + l.government_benefits + l.interest_other + l.other_income + l.eligible_dividends + l.other_dividends + l.capital_gains;
    if (cash <= 0) continue;
    const investment = l.interest_other + l.eligible_dividends + l.other_dividends + l.capital_gains;
    taxpayers.push({
      name: row.name, registeredDraws: l.pension_registered, nonRegisteredDraws: round2(investment), taxableGains: r.taxableGains, dividendsGrossedUp: r.dividendsGrossedUp, dividendCredit: r.dividendCredit,
      tfsaDraws: 0, benefits: l.government_benefits, taxableIncome: r.taxableIncome, federalTax: r.federalTax, provincialTax: r.provincialTax, totalTax: r.totalTax,
      effectiveRate: cash > 0 ? r.totalTax / cash : 0, marginalRate: r.marginalRate,
    });
    totalDraws += cash - l.government_benefits; totalBenefits += l.government_benefits; gross += cash;
  }
  if (!taxpayers.length) return null;
  const totalTax = taxpayers.reduce((a, t) => a + t.totalTax, 0);
  return {
    province, basis: "household_tax_page", mix: null, taxYearTables: TAX_TABLES.asOfYear, taxpayers, totalDraws: round2(totalDraws), totalBenefits: round2(totalBenefits),
    grossIncome: round2(gross), totalTax: round2(totalTax), afterTaxIncome: round2(gross - totalTax), effectiveRate: gross > 0 ? totalTax / gross : 0, notes: [],
  };
}
