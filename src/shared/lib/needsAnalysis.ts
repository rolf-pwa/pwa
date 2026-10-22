// needsAnalysis.ts: the life insurance need by the DIME method (Debt, Income, Mortgage, Estate). Pure; the card on the Insurance tab and the saved
// analysis both use it. Amounts are in today's dollars: the income piece is income x years, with no discounting, so it errs on the side of more cover.
export interface DimeInputs {
  /** Debts other than the mortgage: loans, lines of credit, cards. */
  debt: number;
  /** Gross annual income to replace. */
  annualIncome: number;
  /** How many years the family needs it. */
  incomeYears: number;
  /** Annual income the survivor already has that carries on, taken off the income to replace. */
  survivorIncome: number;
  /** Mortgage balances. */
  mortgage: number;
  /** Funeral and last expenses. */
  finalExpenses: number;
  /** Tax due at death (deferred tax on RRSP/RRIF, capital gains), plus legal and probate. */
  taxesAndLegal: number;
  /** Education still to fund, in total. Optional. */
  education: number;
  /** Life insurance in force on this person. */
  lifeInsurance: number;
  /** Liquid assets the family would use rather than insurance. */
  liquidAssets: number;
  /** CPP/QPP death benefit. */
  cppDeathBenefit: number;
}

export interface DimeResult {
  debt: number;
  income: number;
  mortgage: number;
  estate: number;
  need: number;
  available: number;
  shortfall: number;
  surplus: number;
  /** How much of the need is met, 0 to 100. 100 when there is no need. */
  percentMet: number;
}

export const DIME_DEFAULTS: DimeInputs = {
  debt: 0, annualIncome: 0, incomeYears: 10, survivorIncome: 0, mortgage: 0,
  finalExpenses: 10000, taxesAndLegal: 0, education: 0, lifeInsurance: 0, liquidAssets: 0, cppDeathBenefit: 2500,
};

const amount = (v: unknown) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 0);

export function dime(raw: Partial<DimeInputs>): DimeResult {
  const i = { ...DIME_DEFAULTS, ...Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, amount(v)])) } as DimeInputs;
  const debt = i.debt;
  const income = Math.max(0, i.annualIncome - i.survivorIncome) * i.incomeYears;
  const mortgage = i.mortgage;
  const estate = i.finalExpenses + i.taxesAndLegal + i.education;
  const need = debt + income + mortgage + estate;
  const available = i.lifeInsurance + i.liquidAssets + i.cppDeathBenefit;
  const gap = need - available;
  return {
    debt, income, mortgage, estate, need, available,
    shortfall: Math.max(0, gap), surplus: Math.max(0, -gap),
    percentMet: need <= 0 ? 100 : Math.min(100, Math.round((available / need) * 100)),
  };
}

/** Liabilities by kind, for filling Debt and Mortgage from what is already on file. */
export function splitLiabilities(rows: { liability_type: string; current_balance: number | string | null }[]): { debt: number; mortgage: number } {
  let debt = 0, mortgage = 0;
  for (const r of rows) {
    const b = amount(r.current_balance);
    if (r.liability_type === "mortgage") mortgage += b; else debt += b;
  }
  return { debt, mortgage };
}
