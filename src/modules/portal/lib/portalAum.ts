// Shared AUM logic for /portal and /vfo — mirrors /contacts logic:
// AUM = Vineyard + Storehouses (excluding real estate) + Holding Tank
//     + Insurance cash_value assigned to a storehouse in scope
// Life insurance coverage is NOT included in AUM.

const REAL_ESTATE = "Primary Residence & Protected Legacy Accounts";

export const formatCurrency = (value: number) =>
  new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);

export const isAumStorehouse = (s: any) => s?.asset_type !== REAL_ESTATE;

export const sumValues = (rows: any[]) =>
  (rows || []).reduce((s: number, r: any) => s + (Number(r?.current_value) || 0), 0);

// Cash value always belongs to Strategic Reserve, by policy — not linked to a specific
// storehouse account row, so it can't be broken by deleting a manual account. `policies`
// is expected to already be scoped (visibility/contact) by the caller.
export const insuranceCashForStorehouses = (policies: any[]): number =>
  (policies || []).reduce((s: number, p: any) => s + (Number(p.cash_value) || 0), 0);

export const computeAum = (
  vineyard: any[],
  storehouses: any[],
  holdingTank: any[] = [],
  insurance: any[] = []
): number => {
  const store = (storehouses || []).filter(isAumStorehouse);
  return (
    sumValues(vineyard) +
    sumValues(store) +
    sumValues(holdingTank) +
    insuranceCashForStorehouses(insurance)
  );
};

/** "Smith" -> "Smith Household"; a label that already says Household (e.g. "Geneva Household") is left alone. */
export const householdName = (label?: string | null) => {
  const l = (label || "").trim();
  if (!l) return "Household";
  return /household$/i.test(l) ? l : `${l} Household`;
};
