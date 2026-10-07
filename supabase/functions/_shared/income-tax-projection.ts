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

import { TAX_TABLES, type TaxBracket } from "./governance-audit-tax-config.ts";
import type { IncomeMix } from "./tax-slip-mix.ts";

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
  basis: "tax_slips" | "unrealised_gain";
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

function progressive(income: number, brackets: TaxBracket[], bpa: number | undefined): { tax: number; marginal: number } {
  let tax = 0, lower = 0, marginal = brackets[0]?.rate ?? 0;
  for (const b of brackets) {
    const upper = b.upTo ?? Infinity;
    if (income > lower) { tax += (Math.min(income, upper) - lower) * b.rate; marginal = b.rate; }
    lower = upper;
    if (income <= upper) break;
  }
  if (bpa) tax -= Math.min(income, bpa) * brackets[0].rate; // credit at the lowest rate
  return { tax: Math.max(0, tax), marginal };
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
    const mine = draws.filter((a) => (a.owner ?? "Household") === name);
    let registeredDraws = 0, nonRegisteredDraws = 0, taxableGains = 0, tfsaDraws = 0, ordinary = 0, eligible = 0, otherDiv = 0;
    const mix = opts.mix ?? null;
    for (const a of mine) {
      const type = a.accountType.trim().toLowerCase();
      if (type === "tfsa") tfsaDraws += a.amount;
      else if (REGISTERED.has(type)) registeredDraws += a.amount;
      else {
        nonRegisteredDraws += a.amount;
        if (mix) {
          ordinary += a.amount * mix.shares.interest;
          eligible += a.amount * mix.shares.eligibleDividends;
          otherDiv += a.amount * mix.shares.otherDividends;
          taxableGains += a.amount * mix.shares.capitalGains * TAX_TABLES.capitalGainsInclusionRate;
          continue;
        }
        const gainShare = a.bookValue > 0 && a.currentValue > a.bookValue ? (a.currentValue - a.bookValue) / a.currentValue : 0;
        taxableGains += a.amount * gainShare * TAX_TABLES.capitalGainsInclusionRate;
      }
    }
    const gu = TAX_TABLES.dividendGrossUp;
    const eligibleGross = eligible * (1 + gu.eligible), otherGross = otherDiv * (1 + gu.other);
    const dividendsGrossedUp = eligibleGross + otherGross;
    const taxableIncome = registeredDraws + ordinary + dividendsGrossedUp + taxableGains + share;
    const credit = (c?: { eligible: number; other: number }) => (c ? eligibleGross * c.eligible + otherGross * c.other : 0);
    const fed = progressive(taxableIncome, TAX_TABLES.federal.brackets, TAX_TABLES.federal.basicPersonalAmount);
    const pro = progressive(taxableIncome, prov.brackets, prov.basicPersonalAmount);
    const fedTax = Math.max(0, fed.tax - credit(TAX_TABLES.federal.dividendCredits));
    const proTax = Math.max(0, pro.tax - credit(prov.dividendCredits));
    const dividendCredit = credit(TAX_TABLES.federal.dividendCredits) + credit(prov.dividendCredits);
    const totalTax = fedTax + proTax;
    const gross = registeredDraws + nonRegisteredDraws + tfsaDraws + share;
    return {
      name, registeredDraws: round2(registeredDraws), nonRegisteredDraws: round2(nonRegisteredDraws), taxableGains: round2(taxableGains), dividendsGrossedUp: round2(dividendsGrossedUp), dividendCredit: round2(dividendCredit),
      tfsaDraws: round2(tfsaDraws), benefits: round2(share), taxableIncome: round2(taxableIncome),
      federalTax: round2(fedTax), provincialTax: round2(proTax), totalTax: round2(totalTax),
      effectiveRate: gross > 0 ? totalTax / gross : 0, marginalRate: fed.marginal + pro.marginal,
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
