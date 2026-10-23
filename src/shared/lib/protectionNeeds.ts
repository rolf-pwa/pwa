// protectionNeeds.ts: the disability and critical illness needs. Pure; the cards on the Insurance tab and the saved analyses both use it.
// Disability replaces a share of gross income each month after a waiting period, for a benefit period; for a person with a corporation the
// business overhead expense (BOE) cover is worked out separately, because it reimburses the business, not the person. Amounts are in today's dollars.

export interface DisabilityInputs {
  /** Gross annual income to protect (salary and dividends for an owner). */
  annualIncome: number;
  /** Share of gross income to replace, 0 to 100. */
  replacePercent: number;
  /** Days before benefits start. */
  waitingDays: number;
  /** Months benefits are paid. */
  benefitMonths: number;
  /** Monthly disability benefit from a group plan. */
  groupBenefit: number;
  /** Monthly CPP/QPP disability benefit expected. */
  cppBenefit: number;
  /** Monthly benefit of the individual disability policies in force. */
  inForce: number;
  /** True when the person has a corporation: BOE cover is worked out as well. */
  hasCorporation: boolean;
  /** Fixed monthly business expenses the corporation must keep paying: rent, salaries, utilities, insurance. */
  boeMonthlyExpenses: number;
  /** Months the BOE benefit is paid. */
  boeMonths: number;
  /** Monthly BOE benefit in force. */
  boeInForce: number;
}

export const DISABILITY_DEFAULTS: DisabilityInputs = {
  annualIncome: 0, replacePercent: 70, waitingDays: 30, benefitMonths: 24, groupBenefit: 0, cppBenefit: 0, inForce: 0,
  hasCorporation: false, boeMonthlyExpenses: 0, boeMonths: 12, boeInForce: 0,
};

export interface DisabilityResult {
  monthlyIncome: number;
  /** The monthly income to replace. */
  target: number;
  available: number;
  /** The monthly benefit still needed. */
  gap: number;
  surplus: number;
  percentMet: number;
  /** Income to carry the person through the waiting period, before any benefit is paid. */
  waitingBridge: number;
  /** What the gap adds up to over the benefit period. */
  exposure: number;
  boe: { need: number; gap: number; percentMet: number; exposure: number } | null;
}

const amount = (v: unknown) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 0);
const clean = <T extends object>(raw: Partial<T>, defaults: T): T => ({ ...defaults, ...Object.fromEntries(Object.entries(raw).filter(([k]) => k !== "hasCorporation").map(([k, v]) => [k, amount(v)])), hasCorporation: raw && (raw as any).hasCorporation === true } as T);
const pct = (have: number, need: number) => (need <= 0 ? 100 : Math.min(100, Math.round((have / need) * 100)));

export function disability(raw: Partial<DisabilityInputs>): DisabilityResult {
  const i = clean(raw, DISABILITY_DEFAULTS);
  const replace = Math.min(100, i.replacePercent);
  const monthlyIncome = i.annualIncome / 12;
  const target = monthlyIncome * (replace / 100);
  const available = i.groupBenefit + i.cppBenefit + i.inForce;
  const gap = Math.max(0, target - available);
  const boeGap = Math.max(0, i.boeMonthlyExpenses - i.boeInForce);
  return {
    monthlyIncome, target, available, gap, surplus: Math.max(0, available - target), percentMet: pct(available, target),
    waitingBridge: target * (i.waitingDays / 30), exposure: gap * i.benefitMonths,
    boe: i.hasCorporation ? { need: i.boeMonthlyExpenses, gap: boeGap, percentMet: pct(i.boeInForce, i.boeMonthlyExpenses), exposure: boeGap * i.boeMonths } : null,
  };
}

export interface CriticalIllnessInputs {
  annualIncome: number;
  /** Years of gross income to cover while recovering. */
  incomeYears: number;
  /** Treatment, travel, home help and other costs of recovery. */
  treatmentCosts: number;
  /** Debts to clear if wanted; zero by default. */
  debts: number;
  /** Critical illness cover in force. */
  inForce: number;
}
export const CI_DEFAULTS: CriticalIllnessInputs = { annualIncome: 0, incomeYears: 1, treatmentCosts: 25000, debts: 0, inForce: 0 };

export interface CriticalIllnessResult { income: number; treatment: number; debts: number; need: number; available: number; shortfall: number; surplus: number; percentMet: number }

export function criticalIllness(raw: Partial<CriticalIllnessInputs>): CriticalIllnessResult {
  const i = clean(raw, CI_DEFAULTS);
  const income = i.annualIncome * i.incomeYears;
  const need = income + i.treatmentCosts + i.debts;
  const gap = need - i.inForce;
  return { income, treatment: i.treatmentCosts, debts: i.debts, need, available: i.inForce, shortfall: Math.max(0, gap), surplus: Math.max(0, -gap), percentMet: pct(i.inForce, need) };
}
