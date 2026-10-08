// Pure helpers for rental properties: net rental income from the annual lines, ownership shares, equity.

export const EXPENSE_KEYS = ["property_tax", "insurance", "repairs_maintenance", "management_fees", "utilities", "mortgage_interest", "other_expenses"] as const;
export type ExpenseKey = (typeof EXPENSE_KEYS)[number];

export const EXPENSE_LABELS: Record<ExpenseKey, string> = {
  property_tax: "Property tax", insurance: "Insurance", repairs_maintenance: "Repairs and maintenance", management_fees: "Management fees",
  utilities: "Utilities", mortgage_interest: "Mortgage interest", other_expenses: "Other expenses",
};

export type YearLines = { rent_collected: number } & Record<ExpenseKey, number>;

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export const emptyYear = (): YearLines => ({ rent_collected: 0, property_tax: 0, insurance: 0, repairs_maintenance: 0, management_fees: 0, utilities: 0, mortgage_interest: 0, other_expenses: 0 });

export const totalExpenses = (y: Partial<YearLines>): number => round2(EXPENSE_KEYS.reduce((a, k) => a + num(y[k]), 0));

/** Net rental income for the year: rent collected less every expense. Negative is a rental loss. */
export const netRentalIncome = (y: Partial<YearLines>): number => round2(num(y.rent_collected) - totalExpenses(y));

export interface Owner { contact_id: string; ownership_pct: number }

/** Each owner's share of an amount, by ownership %. Percentages that don't add to 100 are used as given (a partial holding), never rescaled. */
export function ownerShares(amount: number, owners: Owner[]): { contact_id: string; amount: number }[] {
  return owners.map((o) => ({ contact_id: o.contact_id, amount: round2((amount * num(o.ownership_pct)) / 100) }));
}

export const ownershipTotal = (owners: Owner[]): number => round2(owners.reduce((a, o) => a + num(o.ownership_pct), 0));

/** Value less the mortgage balance. null without a value. */
export const equity = (value: number | null, mortgageBalance: number | null): number | null =>
  value === null ? null : round2(value - (mortgageBalance ?? 0));

/** What the net income does: stays with the household, or pays down a linked loan. Never negative (a loss isn't paid out). */
export function incomeUse(net: number, use: "household" | "debt_paydown", hasPaydownTarget: boolean): { toHousehold: number; toPaydown: number } {
  const positive = Math.max(0, net);
  if (use === "debt_paydown" && hasPaydownTarget) return { toHousehold: 0, toPaydown: positive };
  return { toHousehold: positive, toPaydown: 0 };
}
