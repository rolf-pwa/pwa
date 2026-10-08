// Net rental income for a household's rental properties in a tax year, by owner and by where the income goes.
// The pure summary is separate from the database read so it can be tested. Mirrors src/modules/crm/lib/rentalProperty.ts.

const EXPENSES = ["property_tax", "insurance", "repairs_maintenance", "management_fees", "utilities", "mortgage_interest", "other_expenses"] as const;
const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : Number.isFinite(Number(v)) ? Number(v) : 0);
const round2 = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100;

export interface RentalPropertyRow { id: string; name: string; net_income_use: "household" | "debt_paydown"; paydown_liability_id: string | null }
export interface RentalOwnerRow { property_id: string; contact_id: string; ownership_pct: number }
export type RentalYearRow = { property_id: string; tax_year: number; rent_collected: number } & Record<(typeof EXPENSES)[number], number>;

export interface RentalSummary {
  year: number;
  /** Net rental income of all properties (losses included). */
  net: number;
  /** Positive net income that stays with the household vs pays down a linked loan. */
  toHousehold: number;
  toPaydown: number;
  /** Each owner's share of the net income, by ownership %. */
  byContact: Record<string, number>;
  properties: { id: string; name: string; net: number; use: "household" | "debt_paydown" }[];
}

export const netRental = (y: Record<string, unknown>): number => round2(n(y.rent_collected) - EXPENSES.reduce((a, k) => a + n(y[k]), 0));

/** null when no property has a row for the year. */
export function summariseRental(properties: RentalPropertyRow[], owners: RentalOwnerRow[], years: RentalYearRow[], year: number): RentalSummary | null {
  const out: RentalSummary = { year, net: 0, toHousehold: 0, toPaydown: 0, byContact: {}, properties: [] };
  for (const p of properties) {
    const row = years.find((y) => y.property_id === p.id && y.tax_year === year);
    if (!row) continue;
    const net = netRental(row as unknown as Record<string, unknown>);
    out.net = round2(out.net + net);
    const positive = Math.max(0, net);
    if (p.net_income_use === "debt_paydown" && p.paydown_liability_id) out.toPaydown = round2(out.toPaydown + positive);
    else out.toHousehold = round2(out.toHousehold + positive);
    for (const o of owners.filter((x) => x.property_id === p.id)) out.byContact[o.contact_id] = round2((out.byContact[o.contact_id] ?? 0) + (net * n(o.ownership_pct)) / 100);
    out.properties.push({ id: p.id, name: p.name, net, use: p.net_income_use });
  }
  return out.properties.length ? out : null;
}

// deno-lint-ignore no-explicit-any
export async function loadRentalSummary(db: any, householdId: string, year: number): Promise<RentalSummary | null> {
  const { data: props } = await db.from("rental_properties").select("id, name, net_income_use, paydown_liability_id").eq("household_id", householdId);
  if (!props?.length) return null;
  const ids = props.map((p: { id: string }) => p.id);
  const [{ data: owners }, { data: years }] = await Promise.all([
    db.from("rental_property_owners").select("property_id, contact_id, ownership_pct").in("property_id", ids),
    db.from("rental_property_years").select("*").in("property_id", ids).eq("tax_year", year),
  ]);
  return summariseRental(props, owners ?? [], years ?? [], year);
}
