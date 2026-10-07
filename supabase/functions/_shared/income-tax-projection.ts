// This year's income tax on the family's yearly income, estimated from the maintained tax tables
// (governance-audit-tax-config.ts). Pure: the model never does this arithmetic.
//
// What is counted as taxable income, per taxpayer:
//  - withdrawals from registered accounts (RRSP / RRIF / LIRA / LIF): in full;
//  - withdrawals from non-registered accounts: only the share that is gain, at the capital gains inclusion rate. The
//    gain share is the account's unrealised gain over its value (average cost), so it is an approximation;
//  - withdrawals from a TFSA: not taxable;
//  - government benefits (CPP / OAS) and other outside income stated in the Charter: in full.
// Credits other than the basic personal amount (age, pension, medical), OAS recovery tax and income splitting are NOT
// modelled, and neither is tax on income-fund distributions inside non-registered accounts. The result is an estimate.

import { TAX_TABLES, type TaxBracket } from "./governance-audit-tax-config.ts";

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
export function projectIncomeTax(opts: { province: string; accounts: DrawAccount[]; benefitsTotal: number; benefitsLabel?: string }): IncomeTaxProjection | null {
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
    let registeredDraws = 0, nonRegisteredDraws = 0, taxableGains = 0, tfsaDraws = 0;
    for (const a of mine) {
      const type = a.accountType.trim().toLowerCase();
      if (type === "tfsa") tfsaDraws += a.amount;
      else if (REGISTERED.has(type)) registeredDraws += a.amount;
      else {
        nonRegisteredDraws += a.amount;
        const gainShare = a.bookValue > 0 && a.currentValue > a.bookValue ? (a.currentValue - a.bookValue) / a.currentValue : 0;
        taxableGains += a.amount * gainShare * TAX_TABLES.capitalGainsInclusionRate;
      }
    }
    const taxableIncome = registeredDraws + taxableGains + share;
    const fed = progressive(taxableIncome, TAX_TABLES.federal.brackets, TAX_TABLES.federal.basicPersonalAmount);
    const pro = progressive(taxableIncome, prov.brackets, prov.basicPersonalAmount);
    const totalTax = fed.tax + pro.tax;
    const gross = registeredDraws + nonRegisteredDraws + tfsaDraws + share;
    return {
      name, registeredDraws: round2(registeredDraws), nonRegisteredDraws: round2(nonRegisteredDraws), taxableGains: round2(taxableGains),
      tfsaDraws: round2(tfsaDraws), benefits: round2(share), taxableIncome: round2(taxableIncome),
      federalTax: round2(fed.tax), provincialTax: round2(pro.tax), totalTax: round2(totalTax),
      effectiveRate: gross > 0 ? totalTax / gross : 0, marginalRate: fed.marginal + pro.marginal,
    };
  });

  const totalDraws = draws.reduce((a, d) => a + d.amount, 0);
  const grossIncome = totalDraws + opts.benefitsTotal;
  const totalTax = taxpayers.reduce((a, t) => a + t.totalTax, 0);
  if (draws.some((a) => !REGISTERED.has(a.accountType.trim().toLowerCase()) && a.accountType.trim().toLowerCase() !== "tfsa" && !(a.bookValue > 0)))
    notes.push("Some non-registered accounts have no book value on file, so their withdrawals are treated as return of capital (no tax).");
  return {
    province: opts.province, taxYearTables: TAX_TABLES.asOfYear, taxpayers, totalDraws: round2(totalDraws), totalBenefits: round2(opts.benefitsTotal),
    grossIncome: round2(grossIncome), totalTax: round2(totalTax), afterTaxIncome: round2(grossIncome - totalTax),
    effectiveRate: grossIncome > 0 ? totalTax / grossIncome : 0, notes,
  };
}
